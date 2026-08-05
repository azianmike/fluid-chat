import { beforeEach, describe, expect, it } from "vitest";
import { enforceCsrf, enforceRateLimit, resetRateLimits } from "@/lib/guards";
import { HttpError } from "@/lib/http";

function request(method: string, path = "/auth/signup", origin?: string, ip = "127.0.0.1") {
  return {
    method,
    url: `https://chat.example.com/api${path}`,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "origin") return origin ?? null;
        if (name.toLowerCase() === "x-forwarded-for") return ip;
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
