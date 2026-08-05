import { describe, expect, it } from "vitest";
import { avatarColorFor, effectivePresence, toPublicUser } from "@/server/services/serializers";
import type { User } from "@/db/schema";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "0f2b6a1c-8f3d-4a2e-9c1f-2b3d4e5f6a7b",
    email: "ada@example.com",
    emailVerifiedAt: null,
    passwordHash: "hash",
    displayName: "Ada Lovelace",
    handle: "ada",
    avatarUrl: null,
    avatarColor: null,
    title: null,
    pronouns: null,
    phone: null,
    timezone: "UTC",
    statusEmoji: null,
    statusText: null,
    statusExpiresAt: null,
    presence: "active",
    dndUntil: null,
    lastActiveAt: new Date(),
    preferences: null,
    isBot: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides
  } as User;
}

describe("presence", () => {
  it("keeps recently active people active", () => {
    expect(effectivePresence(user({ lastActiveAt: new Date() }))).toBe("active");
  });

  it("drifts to away after a minute of silence", () => {
    expect(effectivePresence(user({ lastActiveAt: new Date(Date.now() - 2 * 60_000) }))).toBe("away");
  });

  it("drops to offline after five minutes", () => {
    expect(effectivePresence(user({ lastActiveAt: new Date(Date.now() - 10 * 60_000) }))).toBe("offline");
  });

  it("honours do not disturb over activity", () => {
    expect(effectivePresence(user({ dndUntil: new Date(Date.now() + 60_000) }))).toBe("dnd");
  });

  it("expires do not disturb", () => {
    expect(effectivePresence(user({ dndUntil: new Date(Date.now() - 60_000) }))).toBe("active");
  });
});

describe("public user serialisation", () => {
  it("hides an expired status", () => {
    const dto = toPublicUser(
      user({ statusEmoji: "palm_tree", statusText: "On leave", statusExpiresAt: new Date(Date.now() - 1000) })
    );
    expect(dto.statusText).toBeNull();
    expect(dto.statusEmoji).toBeNull();
  });

  it("keeps a live status", () => {
    const dto = toPublicUser(
      user({ statusEmoji: "palm_tree", statusText: "On leave", statusExpiresAt: new Date(Date.now() + 60_000) })
    );
    expect(dto.statusText).toBe("On leave");
  });

  it("never leaks the password hash", () => {
    expect(Object.keys(toPublicUser(user()))).not.toContain("passwordHash");
  });

  it("assigns a stable fallback avatar colour", () => {
    expect(avatarColorFor("abc")).toBe(avatarColorFor("abc"));
    expect(avatarColorFor("abc")).toMatch(/^#[0-9a-f]{6}$/);
  });
});
