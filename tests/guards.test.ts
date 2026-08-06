import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { enforceCsrf, enforceRateLimit, resetRateLimits } from "@/lib/guards";
import { HttpError } from "@/lib/http";

function request(method: string, path = "/auth/signup", origin?: string, ip = "127.0.0.1", extra: Record<string, string> = {}) {
  return {
    method,
    url: `https://chat.example.com/api${path}`,
    headers: {
      get(name: string) {
        const key = name.toLowerCase();
        if (key === "origin") return origin ?? null;
        if (key === "x-forwarded-for") return ip;
        return extra[key] ?? null;
      }
    }
  } as never;
}

/** How the request reaches the app once nginx has terminated TLS in front of it. */
function proxied(method: string, origin: string, path = "/auth/signup") {
  return {
    method,
    url: `http://localhost:3100/api${path}`,
    headers: {
      get(name: string) {
        const key = name.toLowerCase();
        if (key === "origin") return origin;
        if (key === "host" || key === "x-forwarded-host") return "chat.example.com";
        if (key === "x-forwarded-proto") return "https";
        if (key === "x-forwarded-for") return "127.0.0.1";
        return null;
      }
    }
  } as never;
}

describe("request guards", () => {
  beforeEach(() => resetRateLimits());

  it("allows same-origin mutating requests", () => {
    expect(() => enforceCsrf(request("POST", "/auth/signup", "https://chat.example.com"))).not.toThrow();
  });

  it("blocks cross-origin mutating requests", () => {
    expect(() => enforceCsrf(request("POST", "/auth/signup", "https://evil.example.com"))).toThrow(HttpError);
  });

  it("does not require origin on safe requests", () => {
    expect(() => enforceCsrf(request("GET", "/auth/me", "https://evil.example.com"))).not.toThrow();
  });

  describe("behind a reverse proxy", () => {
    afterEach(() => {
      delete process.env.APP_URL;
    });

    it("judges origin against APP_URL, not the internal bind address", () => {
      process.env.APP_URL = "https://chat.example.com";
      expect(() => enforceCsrf(proxied("POST", "https://chat.example.com"))).not.toThrow();
      expect(() => enforceCsrf(proxied("POST", "https://evil.example.com"))).toThrow(HttpError);
    });

    it("falls back to the forwarded host and protocol when APP_URL is unset", () => {
      expect(() => enforceCsrf(proxied("POST", "https://chat.example.com"))).not.toThrow();
      expect(() => enforceCsrf(proxied("POST", "http://chat.example.com"))).toThrow(HttpError);
    });

    it("ignores a trailing path on APP_URL", () => {
      process.env.APP_URL = "https://chat.example.com/";
      expect(() => enforceCsrf(proxied("POST", "https://chat.example.com"))).not.toThrow();
    });

    it("does not lock everyone out when APP_URL is malformed", () => {
      process.env.APP_URL = "not a url";
      expect(() => enforceCsrf(proxied("POST", "https://chat.example.com"))).not.toThrow();
    });

    it("keeps only the first value of an appended forwarded header", () => {
      const spoofed = {
        method: "POST",
        url: "http://localhost:3100/api/auth/signup",
        headers: {
          get(name: string) {
            const key = name.toLowerCase();
            if (key === "origin") return "https://evil.example.com";
            if (key === "x-forwarded-host") return "chat.example.com, evil.example.com";
            if (key === "x-forwarded-proto") return "https, http";
            return null;
          }
        }
      } as never;
      expect(() => enforceCsrf(spoofed)).toThrow(HttpError);
    });
  });

  it("rate limits credential endpoints hard", () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      enforceRateLimit(request("POST", "/auth/login"), "/auth/login");
    }
    expect(() => enforceRateLimit(request("POST", "/auth/login"), "/auth/login")).toThrow(HttpError);
  });

  it("keeps separate budgets per client", () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      enforceRateLimit(request("POST", "/auth/login", undefined, "10.0.0.1"), "/auth/login");
    }
    expect(() =>
      enforceRateLimit(request("POST", "/auth/login", undefined, "10.0.0.2"), "/auth/login")
    ).not.toThrow();
  });

  it("is permissive on ordinary reads", () => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      enforceRateLimit(request("GET", "/workspaces"), "/workspaces");
    }
    expect(() => enforceRateLimit(request("GET", "/workspaces"), "/workspaces")).not.toThrow();
  });
});
