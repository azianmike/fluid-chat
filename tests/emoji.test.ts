import { describe, expect, it } from "vitest";
import { EMOJI_CATEGORIES, applySkinTone, emojiChar, searchEmoji } from "@/client/emoji";

describe("emoji catalog", () => {
  it("resolves shortcodes and aliases", () => {
    expect(emojiChar("rocket")).toBe("🚀");
    expect(emojiChar("ROCKET")).toBe("🚀");
    expect(emojiChar("thumbsup")).toBe(emojiChar("+1"));
    expect(emojiChar("not_a_real_emoji")).toBeUndefined();
  });

  it("defers to custom emoji when the workspace defines one", () => {
    const custom = new Map([["rocket", "/api/files/abc/download"]]);
    expect(emojiChar("rocket", custom)).toBeUndefined();
  });

  it("searches names and keywords", () => {
    expect(searchEmoji("rocket").map(([name]) => name)).toContain("rocket");
    expect(searchEmoji("deploy").map(([name]) => name)).toContain("rocket");
    expect(searchEmoji("")).toEqual([]);
  });

  it("applies skin tones only to hand emoji", () => {
    expect(applySkinTone("👍", 3)).not.toBe("👍");
    expect(applySkinTone("🚀", 3)).toBe("🚀");
    expect(applySkinTone("👍", 0)).toBe("👍");
  });

  it("keeps shortcodes unique across categories", () => {
    const names = EMOJI_CATEGORIES.flatMap((category) => category.emoji.map(([name]) => name));
    expect(new Set(names).size).toBe(names.length);
  });
});
