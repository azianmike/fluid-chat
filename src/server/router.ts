import { NextRequest } from "next/server";
import { z } from "zod";
import { HttpError } from "@/lib/http";
import { currentUser, requireUser } from "@/lib/auth";
import type { User } from "@/db/schema";

/**
 * A tiny, dependency-free router.
 *
 * Route modules declare a map of `"METHOD /path/:param"` keys to handlers, which
 * keeps every domain's surface readable in one glance and makes adding a feature
 * a one-line change. Patterns are compiled once at module load.
 */

export type RouteHandler = (ctx: Context) => Promise<unknown> | unknown;
export type RouteMap = Record<string, RouteHandler>;

type CompiledRoute = {
  method: string;
  segments: string[];
  paramNames: (string | null)[];
  handler: RouteHandler;
  spec: string;
};

export class Context {
  readonly url: URL;
  private cachedUser?: User | null;
  private cachedBody?: unknown;

  constructor(
    readonly request: NextRequest,
    readonly params: Record<string, string>
  ) {
    this.url = new URL(request.url);
  }

  get method() {
    return this.request.method;
  }

  /** Route parameter, validated as a UUID unless `raw` is set. */
  param(name: string, options?: { raw?: boolean }) {
    const value = this.params[name];
    if (!value) throw new HttpError(400, `Missing ${name}`, "missing_param");
    if (!options?.raw && !isUuid(value)) throw new HttpError(400, `Invalid ${name}`, "invalid_param");
    return value;
  }

  query(name: string) {
    return this.url.searchParams.get(name) ?? undefined;
  }

  queryFlag(name: string) {
    return this.url.searchParams.get(name) === "true";
  }

  queryInt(name: string, fallback: number, max = 200) {
    const raw = this.url.searchParams.get(name);
    if (!raw) return fallback;
    const value = Number.parseInt(raw, 10);
    if (!Number.isFinite(value) || value <= 0) return fallback;
    return Math.min(value, max);
  }

  /** Parses and validates the JSON body. Repeated calls reuse the parsed value. */
  async input<S extends z.ZodTypeAny>(schema: S): Promise<z.infer<S>> {
    if (this.cachedBody === undefined) {
      const text = await this.request.text();
      this.cachedBody = text ? safeJsonParse(text) : {};
    }
    return schema.parse(this.cachedBody);
  }

  async user(): Promise<User> {
    if (this.cachedUser === undefined) this.cachedUser = await currentUser();
    if (!this.cachedUser) return requireUser();
    return this.cachedUser;
  }

  async optionalUser(): Promise<User | null> {
    if (this.cachedUser === undefined) this.cachedUser = await currentUser();
    return this.cachedUser;
  }
}

function safeJsonParse(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new HttpError(400, "Request body must be valid JSON", "invalid_json");
  }
}

export function isUuid(value: string | undefined): value is string {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function defineRoutes(routes: RouteMap): RouteMap {
  return routes;
}

export function compileRoutes(maps: RouteMap[]): CompiledRoute[] {
  const compiled: CompiledRoute[] = [];
  for (const map of maps) {
    for (const [spec, handler] of Object.entries(map)) {
      const [method, pattern] = spec.split(" ");
      if (!method || !pattern) throw new Error(`Invalid route spec: ${spec}`);
      const segments = pattern.split("/").filter(Boolean);
      compiled.push({
        method: method.toUpperCase(),
        spec,
        handler,
        segments,
        paramNames: segments.map((segment) => (segment.startsWith(":") ? segment.slice(1) : null))
      });
    }
  }
  // Static segments win over parameters so `/conversations/dm` beats `/conversations/:id`.
  return compiled.sort((a, b) => score(b) - score(a));
}

function score(route: CompiledRoute) {
  return route.paramNames.filter((name) => name === null).length * 10 - route.segments.length;
}

export function matchRoute(routes: CompiledRoute[], method: string, path: string[]) {
  let methodMismatch = false;
  for (const route of routes) {
    if (route.segments.length !== path.length) continue;
    const params: Record<string, string> = {};
    let matched = true;
    for (let index = 0; index < route.segments.length; index += 1) {
      const paramName = route.paramNames[index];
      if (paramName) {
        params[paramName] = decodeURIComponent(path[index]);
        continue;
      }
      if (route.segments[index] !== path[index]) {
        matched = false;
        break;
      }
    }
    if (!matched) continue;
    if (route.method !== method) {
      methodMismatch = true;
      continue;
    }
    return { route, params };
  }
  if (methodMismatch) throw new HttpError(405, "Method not allowed", "method_not_allowed");
  return null;
}
