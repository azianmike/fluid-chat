import { describe, expect, it } from "vitest";
import { enforceCsrf } from "@/lib/guards";
import { HttpError } from "@/lib/http";

function request(method: string, origin?: string) {
  return {
    method,
    url: "https://chat.example.com/api/auth/signup",
    headers: {
      get(name: string) {
        if (name.toLowerCase() === "origin") return origin ?? null;
        if (name.toLowerCase() === "x-forwarded-for") return "127.0.0.1";
        return null;
      }
    }
  } as never;
}

describe("request guards", () => {
  it("allows same-origin mutating requests", () => {
    expect(() => enforceCsrf(request("POST", "https://chat.example.com"))).not.toThrow();
  });

  it("blocks cross-origin mutating requests", () => {
    expect(() => enforceCsrf(request("POST", "https://evil.example.com"))).toThrow(HttpError);
  });

  it("does not require origin on safe requests", () => {
    expect(() => enforceCsrf(request("GET", "https://evil.example.com"))).not.toThrow();
  });
});
