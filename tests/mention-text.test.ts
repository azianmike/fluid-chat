import { describe, expect, it } from "vitest";
import {
  toMentionDisplay,
  toMentionWire,
  userMentionLabel,
  type MentionDirectory
} from "@/shared/mention-text";

const bob = { id: "994beeda-6391-4061-903f-0e1a8019d501", displayName: "Bob Vance", handle: "bob" };
const ada = { id: "0f2b6a1c-8f3d-4a2e-9c1f-2b3d4e5f6a7b", displayName: "Ada Lovelace", handle: null };

const directory: MentionDirectory = {
  users: [bob, ada],
  groups: [{ id: "3d1f7c92-4b5a-4e6d-8f21-77c0a9be1234", handle: "design" }],
  channels: [{ id: "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d", name: "general" }]
};

describe("mention labels", () => {
  it("prefers the handle and falls back to a dotted display name", () => {
    expect(userMentionLabel(bob)).toBe("bob");
    expect(userMentionLabel(ada)).toBe("ada.lovelace");
  });
});

describe("wire to display", () => {
  it("replaces every token with readable text", () => {
    const wire = `<@${bob.id}> and <!group:3d1f7c92-4b5a-4e6d-8f21-77c0a9be1234|design> see <#5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d|general> <!here>`;
    expect(toMentionDisplay(wire, directory)).toBe("@bob and @design see #general @here");
  });

  it("leaves unknown ids alone so nothing is lost", () => {
    const wire = "<@11111111-2222-3333-4444-555555555555> hi";
    expect(toMentionDisplay(wire, directory)).toBe(wire);
  });

  it("does not touch code", () => {
    const wire = `\`<@${bob.id}>\` is the token`;
    expect(toMentionDisplay(wire, directory)).toBe(wire);
  });
});

describe("display to wire", () => {
  it("restores tokens for people, groups, broadcasts and channels", () => {
    const display = "@bob @ada.lovelace @design @here #general";
    expect(toMentionWire(display, directory)).toBe(
      `<@${bob.id}> <@${ada.id}> <!group:3d1f7c92-4b5a-4e6d-8f21-77c0a9be1234|design> <!here> <#5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d|general>`
    );
  });

  it("round-trips", () => {
    const wire = `hey <@${bob.id}>, ping <#5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d|general>`;
    expect(toMentionWire(toMentionDisplay(wire, directory), directory)).toBe(wire);
  });

  it("keeps sentence punctuation out of the label", () => {
    expect(toMentionWire("thanks @bob.", directory)).toBe(`thanks <@${bob.id}>.`);
    expect(toMentionWire("(@bob) ok", directory)).toBe(`(<@${bob.id}>) ok`);
  });

  it("leaves unknown labels as plain text for the server to resolve", () => {
    expect(toMentionWire("@nobody hello", directory)).toBe("@nobody hello");
  });

  it("ignores mid-word @ and code", () => {
    expect(toMentionWire("mail bob@bob.com", directory)).toBe("mail bob@bob.com");
    expect(toMentionWire("```\n@bob\n```", directory)).toBe("```\n@bob\n```");
  });

  it("is case-insensitive about what was typed", () => {
    expect(toMentionWire("@Bob", directory)).toBe(`<@${bob.id}>`);
  });
});
