import { NextRequest } from "next/server";
import { HttpError } from "./http";

const attempts = new Map<string, { count: number; resetAt: number }>();
const mutatingMethods = new Set(["POST", "PATCH", "DELETE"]);

export function enforceCsrf(request: NextRequest) {
  if (!mutatingMethods.has(request.method)) return;
  const origin = request.headers.get("origin");
  if (!origin) return;
  const expected = new URL(request.url).origin;
  if (origin !== expected) throw new HttpError(403, "Invalid request origin", "csrf_failed");
}

export function enforceRateLimit(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
  const bucket = `${ip}:${request.method}:${new URL(request.url).pathname}`;
  const now = Date.now();
  const current = attempts.get(bucket);

  if (!current || current.resetAt < now) {
    attempts.set(bucket, { count: 1, resetAt: now + 60_000 });
    return;
  }

  current.count += 1;
  if (current.count > 60) throw new HttpError(429, "Too many requests", "rate_limited");
}
