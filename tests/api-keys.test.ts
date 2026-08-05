import { beforeEach, describe, expect, it } from "vitest";
import {
  ROUTE_ACCESS,
  SCOPE_NAMES,
  assertRoutesAreClassified,
  grantsScope,
  isRealScope,
  normalizeScopes
} from "@/lib/api-scopes";
import { TOKEN_PREFIX, assertRouteAllowed, newApiToken, readBearerToken } from "@/lib/api-auth";
import { enforceApiKeyRateLimit, enforceCsrf, enforceRateLimit, rateLimitHeaders, resetRateLimits } from "@/lib/guards";
import { HttpError } from "@/lib/http";
import { routeTable } from "@/server";
import { describeRoutes, openApiDocument } from "@/server/services/openapi";
import type { ApiKeyAuth } from "@/lib/api-auth";

function auth(scopes: string[], overrides?: { rateLimitPerMinute?: number; messageLimitPerMinute?: number; id?: string }) {
  return {
    key: {
      id: overrides?.id ?? "key-1",
      rateLimitPerMinute: overrides?.rateLimitPerMinute ?? 120,
      messageLimitPerMinute: overrides?.messageLimitPerMinute ?? 60
    },
    actor: { id: "user-1" },
    workspaceId: "workspace-1",
    scopes,
    role: "member"
  } as unknown as ApiKeyAuth;
}

function request(method: string, headers: Record<string, string> = {}) {
  return {
    method,
    url: "https://chat.example.com/api/conversations/abc/messages",
    headers: {
      get(name: string) {
        return headers[name.toLowerCase()] ?? null;
      }
    }
  } as never;
}

describe("scopes", () => {
  it("classifies every route the router serves", () => {
    expect(() => assertRoutesAreClassified(routeTable)).not.toThrow();
    expect(Object.keys(ROUTE_ACCESS).length).toBe(routeTable.length);
  });

  it("expands wildcards", () => {
    expect(normalizeScopes(["messages:*"])).toEqual(["messages:read", "messages:write"]);
    expect(normalizeScopes(["*"])).toEqual(SCOPE_NAMES);
  });

  it("rejects invented scopes", () => {
    expect(() => normalizeScopes(["messages:destroy"])).toThrow(/Unknown scope/);
    expect(() => normalizeScopes(["nonsense:*"])).toThrow(/Unknown scope/);
    expect(isRealScope("messages:read")).toBe(true);
    expect(isRealScope("session")).toBe(false);
  });

  it("honours wildcard grants without granting neighbours", () => {
    expect(grantsScope(["messages:*"], "messages:write")).toBe(true);
    expect(grantsScope(["messages:*"], "channels:write")).toBe(false);
    expect(grantsScope(["*"], "admin:write")).toBe(true);
    expect(grantsScope(["messages:read"], "messages:write")).toBe(false);
  });

  it("keeps credential management away from keys", () => {
    for (const spec of ["POST /auth/login", "POST /auth/change-password", "GET /auth/sessions", "DELETE /auth/account"]) {
      expect(ROUTE_ACCESS[spec]).toBe("session");
    }
  });
});

describe("route authorisation", () => {
  it("allows a granted scope", () => {
    expect(() => assertRouteAllowed(auth(["messages:write"]), "messages:write", "POST /x")).not.toThrow();
  });

  it("refuses a missing scope", () => {
    try {
      assertRouteAllowed(auth(["messages:read"]), "messages:write", "POST /x");
      throw new Error("expected a 403");
    } catch (error) {
      expect((error as HttpError).status).toBe(403);
      expect((error as HttpError).code).toBe("missing_scope");
    }
  });

  it("refuses session-only routes whatever the scopes", () => {
    try {
      assertRouteAllowed(auth(SCOPE_NAMES), "session", "POST /auth/change-password");
      throw new Error("expected a 403");
    } catch (error) {
      expect((error as HttpError).code).toBe("session_only");
    }
  });

  it("lets any live key read its own identity", () => {
    expect(() => assertRouteAllowed(auth([]), "identity", "GET /auth/me")).not.toThrow();
  });
});

describe("tokens", () => {
  it("mints prefixed, high-entropy secrets", () => {
    const first = newApiToken();
    const second = newApiToken();
    expect(first.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(first.token).not.toBe(second.token);
    expect(first.token.length).toBeGreaterThan(TOKEN_PREFIX.length + 30);
    expect(first.prefix).toBe(first.token.slice(0, TOKEN_PREFIX.length + 6));
    // Only the hash is ever stored.
    expect(first.hash).not.toContain(first.token);
    expect(first.hash).toHaveLength(64);
  });

  it("reads both header styles", () => {
    expect(readBearerToken(request("GET", { authorization: "Bearer abc123" }))).toBe("abc123");
    expect(readBearerToken(request("GET", { "x-api-key": "abc123" }))).toBe("abc123");
    expect(readBearerToken(request("GET", { authorization: "Basic abc123" }))).toBeNull();
    expect(readBearerToken(request("GET"))).toBeNull();
  });
});

describe("rate limits", () => {
  beforeEach(() => resetRateLimits());

  it("enforces the per-minute budget and reports it in headers", () => {
    const key = auth(["messages:read"], { rateLimitPerMinute: 5, id: "budget" });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const status = enforceApiKeyRateLimit(key, "GET", "/workspaces/w/channels");
      expect(status.limit).toBe(5);
    }
    try {
      enforceApiKeyRateLimit(key, "GET", "/workspaces/w/channels");
      throw new Error("expected a 429");
    } catch (error) {
      expect((error as HttpError).status).toBe(429);
      expect((error as HttpError).code).toBe("rate_limited");
    }
  });

  it("caps message sends more tightly than reads", () => {
    const key = auth(["messages:write"], { rateLimitPerMinute: 100, messageLimitPerMinute: 2, id: "poster" });
    enforceApiKeyRateLimit(key, "POST", "/conversations/c1/messages");
    enforceApiKeyRateLimit(key, "POST", "/conversations/c1/messages");
    try {
      enforceApiKeyRateLimit(key, "POST", "/conversations/c1/messages");
      throw new Error("expected a 429");
    } catch (error) {
      expect((error as HttpError).code).toBe("message_rate_limited");
    }
    // Reads still flow: the flood limit is about what lands in front of people.
    expect(() => enforceApiKeyRateLimit(key, "GET", "/conversations/c1/messages")).not.toThrow();
  });

  it("gives each key its own budget", () => {
    const first = auth([], { rateLimitPerMinute: 1, id: "a" });
    const second = auth([], { rateLimitPerMinute: 1, id: "b" });
    enforceApiKeyRateLimit(first, "GET", "/auth/me");
    expect(() => enforceApiKeyRateLimit(second, "GET", "/auth/me")).not.toThrow();
    expect(() => enforceApiKeyRateLimit(first, "GET", "/auth/me")).toThrow(HttpError);
  });

  it("only lifts the IP budget once a key has resolved", () => {
    // The exemption is for *valid* keys. An unresolved bearer header must still
    // pay the per-IP budget, or presenting one would switch the limiter off.
    const unauthenticated = request("GET", { "x-forwarded-for": "203.0.113.7" });
    for (let attempt = 0; attempt < 600; attempt += 1) {
      enforceRateLimit(unauthenticated, "/auth/me");
    }
    expect(() => enforceRateLimit(unauthenticated, "/auth/me")).toThrow(HttpError);
    // A resolved key skips that budget and is metered per key instead.
    expect(() => enforceRateLimit(unauthenticated, "/auth/me", { hasApiKey: true })).not.toThrow();
  });

  it("keeps credential endpoints tight even for resolved keys", () => {
    const keyed = request("POST", { "x-forwarded-for": "203.0.113.8" });
    for (let attempt = 0; attempt < 10; attempt += 1) {
      enforceRateLimit(keyed, "/auth/login", { hasApiKey: true });
    }
    expect(() => enforceRateLimit(keyed, "/auth/login", { hasApiKey: true })).toThrow(HttpError);
  });

  it("adds Retry-After only when refusing", () => {
    const status = { limit: 10, remaining: 3, resetAt: Date.now() + 30_000 };
    expect(rateLimitHeaders(status)["retry-after"]).toBeUndefined();
    expect(rateLimitHeaders(status, { retryAfter: true })["retry-after"]).toBe("30");
    expect(rateLimitHeaders(status)["x-ratelimit-remaining"]).toBe("3");
  });
});

describe("csrf and bearer credentials", () => {
  it("skips the origin check for bearer requests", () => {
    expect(() =>
      enforceCsrf(request("POST", { authorization: "Bearer x", origin: "https://script.example.com" }))
    ).not.toThrow();
  });

  it("still protects cookie-authenticated writes", () => {
    expect(() => enforceCsrf(request("POST", { origin: "https://evil.example.com" }))).toThrow(HttpError);
  });
});

describe("discovery", () => {
  it("describes every route with its access class", () => {
    const described = describeRoutes();
    expect(described.length).toBe(routeTable.length);
    const send = described.find((route) => route.method === "POST" && route.path === "/conversations/:conversationId/messages");
    expect(send?.scope).toBe("messages:write");
    expect(send?.auth).toBe("scope");
  });

  it("publishes an OpenAPI document without the session-only routes", () => {
    const doc = openApiDocument("https://chat.example.com");
    expect(doc.openapi).toBe("3.1.0");
    expect(doc.paths["/conversations/{conversationId}/messages"]).toBeDefined();
    expect(doc.paths["/auth/login"]).toBeUndefined();
    const operation = doc.paths["/messages/{messageId}/reactions"].post as { "x-fluid-scope": string };
    expect(operation["x-fluid-scope"]).toBe("messages:write");
  });
});
