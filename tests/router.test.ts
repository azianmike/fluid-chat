import { describe, expect, it } from "vitest";
import { compileRoutes, defineRoutes, isUuid, matchRoute } from "@/server/router";
import { HttpError } from "@/lib/http";

const routes = compileRoutes([
  defineRoutes({
    "GET /conversations/:conversationId": () => "one",
    "POST /conversations/dm": () => "dm",
    "GET /workspaces/:workspaceId/channels": () => "channels",
    "DELETE /messages/:messageId/reactions/:emoji": () => "reaction"
  })
]);

describe("router", () => {
  it("matches parameterised routes", () => {
    const match = matchRoute(routes, "GET", ["conversations", "abc"]);
    expect(match?.params).toEqual({ conversationId: "abc" });
  });

  it("prefers static segments over parameters", () => {
    const match = matchRoute(routes, "POST", ["conversations", "dm"]);
    expect(match?.route.spec).toBe("POST /conversations/dm");
  });

  it("decodes parameters", () => {
    const match = matchRoute(routes, "DELETE", ["messages", "m1", "reactions", encodeURIComponent("👍")]);
    expect(match?.params.emoji).toBe("👍");
  });

  it("returns null for unknown paths", () => {
    expect(matchRoute(routes, "GET", ["nope"])).toBeNull();
  });

  it("reports a method mismatch as 405", () => {
    try {
      matchRoute(routes, "PATCH", ["conversations", "abc"]);
      throw new Error("expected a 405");
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError);
      expect((error as HttpError).status).toBe(405);
    }
  });

  it("validates uuids", () => {
    expect(isUuid("3f1c1a5e-9f1d-4c0b-9b9a-2f0a1b2c3d4e")).toBe(true);
    expect(isUuid("not-a-uuid")).toBe(false);
    expect(isUuid(undefined)).toBe(false);
  });
});
