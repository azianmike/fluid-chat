import { NextRequest } from "next/server";
import { HttpError } from "./http";

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();
const mutatingMethods = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/** Tighter limits on the endpoints worth brute-forcing. */
const limits: Array<{ test: RegExp; methods?: string[]; max: number; windowMs: number }> = [
  { test: /^\/auth\/(login|signup|forgot-password|reset-password)$/, methods: ["POST"], max: 10, windowMs: 60_000 },
  { test: /^\/files$/, methods: ["POST"], max: 60, windowMs: 60_000 },
  { test: /^\/hooks\//, methods: ["POST"], max: 120, windowMs: 60_000 },
  { test: /^\/.*$/, max: 600, windowMs: 60_000 }
];

export function enforceCsrf(request: NextRequest) {
  if (!mutatingMethods.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "Invalid request origin", "csrf_failed");
}

export function enforceRateLimit(request: NextRequest, path: string) {
  const rule = limits.find((limit) => limit.test.test(path) && (!limit.methods || limit.methods.includes(request.method)));
  if (!rule) return;

  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const key = `${ip}:${request.method}:${rule.test.source}`;
  const now = Date.now();
  const current = buckets.get(key);

  if (!current || current.resetAt < now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    if (buckets.size > 10_000) pruneExpired(now);
    return;
  }

  current.count += 1;
  if (current.count > rule.max) throw new HttpError(429, "Too many requests", "rate_limited");
}

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export function resetRateLimits() {
  buckets.clear();
}
