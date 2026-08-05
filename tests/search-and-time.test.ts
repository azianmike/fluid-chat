import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "@/server/services/search";
import { formatDuration, parseWhen } from "@/server/services/time";
import { parseMentions } from "@/server/services/mentions";

describe("search query operators", () => {
  it("splits operators from free text", () => {
    const parsed = parseSearchQuery("deploy plan in:#release from:@ada has:file before:2026-01-01");
    expect(parsed.text).toBe("deploy plan");
    expect(parsed.in).toEqual(["release"]);
    expect(parsed.from).toEqual(["ada"]);
    expect(parsed.has).toEqual(["file"]);
    expect(parsed.before).toBe("2026-01-01");
  });

  it("supports quoted values and is:pinned", () => {
    const parsed = parseSearchQuery('in:"product design" is:pinned retro');
    expect(parsed.in).toEqual(["product design"]);
    expect(parsed.isPinned).toBe(true);
    expect(parsed.text).toBe("retro");
  });

  it("leaves unknown operators in the text", () => {
    expect(parseSearchQuery("ratio:2 growth").text).toBe("ratio:2 growth");
  });
});

describe("mention parsing", () => {
  const userId = "0f2b6a1c-8f3d-4a2e-9c1f-2b3d4e5f6a7b";

  it("finds ids, handles and broadcasts", () => {
    const targets = parseMentions(`<@${userId}> hey @ada.lovelace and <!channel>`);
    expect(targets.userIds).toEqual([userId]);
    expect(targets.handles).toEqual(["ada.lovelace"]);
    expect(targets.broadcasts).toEqual(["channel"]);
  });

  it("ignores mentions inside code", () => {
    const targets = parseMentions("`@ada` and ```\n@grace\n```");
    expect(targets.handles).toEqual([]);
  });

  it("treats bare @here as a broadcast", () => {
    expect(parseMentions("@here standup in 5").broadcasts).toEqual(["here"]);
  });
});

describe("natural language time", () => {
  const now = new Date("2026-03-04T10:00:00.000Z");

  it("parses relative durations", () => {
    const result = parseWhen("ship the release in 20 minutes", now);
    expect(result?.at.getTime()).toBe(now.getTime() + 20 * 60_000);
    expect(result?.rest).toContain("ship the release");
  });

  it("parses tomorrow with a time", () => {
    const result = parseWhen("tomorrow at 9am", now);
    expect(result?.at.getDate()).toBe(5);
    expect(result?.at.getHours()).toBe(9);
  });

  it("defaults tomorrow to the morning", () => {
    expect(parseWhen("tomorrow", now)?.at.getHours()).toBe(9);
  });

  it("returns null when nothing is parseable", () => {
    expect(parseWhen("whenever you get to it", now)).toBeNull();
  });

  it("formats durations for humans", () => {
    expect(formatDuration(90 * 60_000)).toBe("2 hours");
    expect(formatDuration(60_000)).toBe("1 minute");
  });
});
