import { NextRequest } from "next/server";
import { HttpError } from "./http";
import type { ApiKeyAuth } from "./api-auth";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const mutatingMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Tighter limits on the endpoints worth brute-forcing. */
const limits: Array<{ test: RegExp; methods?: string[]; max: number; windowMs: number; catchAll?: boolean }> = [
  { test: /^\/auth\/(login|signup|forgot-password|reset-password)$/, methods: ["POST"], max: 10, windowMs: 60_000 },
  { test: /^\/files$/, methods: ["POST"], max: 60, windowMs: 60_000 },
  { test: /^\/hooks\//, methods: ["POST"], max: 120, windowMs: 60_000 },
  { test: /^\/.*$/, max: 600, windowMs: 60_000, catchAll: true }
];

/**
 * Requests that create messages get their own, tighter budget: the point of a
 * spam limit is to cap what lands in front of people, and a bot that reads a lot
 * is far less alarming than one that posts a lot.
 */
const messageRoutes = [
  /^\/conversations\/[^/]+\/messages$/,
  /^\/conversations\/[^/]+\/scheduled$/,
  /^\/messages\/[^/]+\/share$/,
  /^\/conversations\/dm$/
];

/** No single workspace may drown the instance, however many keys it holds. */
export const WORKSPACE_CEILING_PER_MINUTE = 6_000;
/** Short-window ceiling, so a key cannot spend a whole minute's budget at once. */
export const BURST_PER_SECOND = 40;

export type RateLimitStatus = {
  limit: number;
  remaining: number;
  resetAt: number;
};

/**
 * The origin browsers actually reach this app on.
 *
 * Behind a reverse proxy `request.url` is the internal bind address
 * (http://localhost:3100), never the public one, so it cannot be used to judge
 * an incoming `Origin`. APP_URL is authoritative because it is the same value
 * the app already builds its own links from; the headers nginx forwards are the
 * fallback, and `request.url` only stands in when nothing is proxying at all.
 */
export function expectedOrigin(request: NextRequest): string {
  const configured = process.env.APP_URL;
  if (configured) {
    try {
      return new URL(configured).origin;
    } catch {
      // A malformed APP_URL should not lock everyone out; fall through.
    }
  }
  const forwardedHost = firstHeaderValue(request, "x-forwarded-host") ?? request.headers.get("host");
  if (forwardedHost) {
    const protocol = firstHeaderValue(request, "x-forwarded-proto") ?? new URL(request.url).protocol.replace(":", "");
    return `${protocol}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

/** Proxy chains append, so only the value this hop was handed is meaningful. */
function firstHeaderValue(request: NextRequest, name: string): string | null {
  const value = request.headers.get(name);
  if (!value) return null;
  const first = value.split(",")[0]?.trim();
  return first ? first : null;
}

export function enforceCsrf(request: NextRequest) {
  if (!mutatingMethods.has(request.method)) return;
  // Bearer credentials are never sent ambiently by a browser, so a cross-origin
  // API call is not a forgery — only cookie-authenticated writes need this.
  if (request.headers.get("authorization") || request.headers.get("x-api-key")) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  if (origin !== expectedOrigin(request)) throw new HttpError(403, "Invalid request origin", "csrf_failed");
}

/**
 * Per-IP limits. `hasApiKey` may only be set once a key has actually resolved:
 * it lifts the general budget (several servers behind one NAT should not share a
 * browser-sized one) in favour of that key's own, tighter-tracked budget.
 */
export function enforceRateLimit(request: NextRequest, path: string, options?: { hasApiKey?: boolean }) {
  const rule = limits.find((limit) => limit.test.test(path) && (!limit.methods || limit.methods.includes(request.method)));
  if (!rule) return;
  if (options?.hasApiKey && rule.catchAll) return;

  const ip = clientIp(request);
  const key = `${ip}:${request.method}:${rule.test.source}`;
  const outcome = consume(key, rule.max, rule.windowMs);
  if (!outcome.allowed) throw rateLimited("Too many requests", outcome.status);
}

/**
 * Per-key limits. Four ceilings, cheapest first, so a caller learns which one it
 * hit from the `code` and can back off intelligently.
 */
export function enforceApiKeyRateLimit(auth: ApiKeyAuth, method: string, path: string): RateLimitStatus {
  const burst = consume(`key:${auth.key.id}:burst`, BURST_PER_SECOND, 1_000);
  if (!burst.allowed) throw rateLimited("Slow down: too many requests in one second", burst.status, "rate_limited_burst");

  const sustained = consume(`key:${auth.key.id}:minute`, auth.key.rateLimitPerMinute, 60_000);
  if (!sustained.allowed) {
    throw rateLimited(
      `This API key is limited to ${auth.key.rateLimitPerMinute} requests per minute`,
      sustained.status
    );
  }

  const workspace = consume(`workspace:${auth.workspaceId}`, WORKSPACE_CEILING_PER_MINUTE, 60_000);
  if (!workspace.allowed) {
    throw rateLimited("This workspace has hit its API ceiling for the minute", workspace.status, "workspace_rate_limited");
  }

  if (method === "POST" && messageRoutes.some((pattern) => pattern.test(path))) {
    const posting = consume(`key:${auth.key.id}:messages`, auth.key.messageLimitPerMinute, 60_000);
    if (!posting.allowed) {
      throw rateLimited(
        `This API key is limited to ${auth.key.messageLimitPerMinute} new messages per minute`,
        posting.status,
        "message_rate_limited"
      );
    }
  }

  return sustained.status;
}

function rateLimited(message: string, status: RateLimitStatus, code = "rate_limited") {
  const error = new HttpError(429, message, code);
  return Object.assign(error, { rateLimit: status });
}

/** The budget a 429 came from, so the response can tell the caller when to retry. */
export function rateLimitStatusOf(error: unknown): RateLimitStatus | null {
  const status = (error as { rateLimit?: RateLimitStatus } | null)?.rateLimit;
  return status ?? null;
}

export function rateLimitHeaders(status: RateLimitStatus, options?: { retryAfter?: boolean }): Record<string, string> {
  const headers: Record<string, string> = {
    "x-ratelimit-limit": String(status.limit),
    "x-ratelimit-remaining": String(Math.max(0, status.remaining)),
    "x-ratelimit-reset": String(Math.ceil(status.resetAt / 1000))
  };
  if (options?.retryAfter) {
    headers["retry-after"] = String(Math.max(1, Math.ceil((status.resetAt - Date.now()) / 1000)));
  }
  return headers;
}

function consume(key: string, max: number, windowMs: number): { allowed: boolean; status: RateLimitStatus } {
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    if (buckets.size > 10_000) pruneExpired(now);
    return { allowed: true, status: { limit: max, remaining: max - 1, resetAt } };
  }

  current.count += 1;
  const status = { limit: max, remaining: max - current.count, resetAt: current.resetAt };
  return { allowed: current.count <= max, status };
}

export function clientIp(request: { headers: { get(name: string): string | null } }) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
}

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
