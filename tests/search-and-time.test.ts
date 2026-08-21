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
    const result = parseWhen("ship the release in 20 minutes", { now });
    expect(result?.at.getTime()).toBe(now.getTime() + 20 * 60_000);
    expect(result?.rest).toContain("ship the release");
  });

  it("parses tomorrow with a time", () => {
    const result = parseWhen("tomorrow at 9am", { now });
    expect(result?.at.toISOString()).toBe("2026-03-05T09:00:00.000Z");
  });

  it("defaults tomorrow to the morning", () => {
    expect(parseWhen("tomorrow", { now })?.at.toISOString()).toBe("2026-03-05T09:00:00.000Z");
  });

  it("returns null when nothing is parseable", () => {
    expect(parseWhen("whenever you get to it", { now })).toBeNull();
  });

  it("means 9am where the person is, not where the server runs", () => {
    // 09:00 on the 5th in Sydney (UTC+11) is 22:00 on the 4th in UTC.
    const sydney = parseWhen("tomorrow at 9am", { now, timeZone: "Australia/Sydney" });
    expect(sydney?.at.toISOString()).toBe("2026-03-04T22:00:00.000Z");

    // Los Angeles is still on the 4th at 02:00 when UTC says 10:00, so its
    // "tomorrow" is the 5th there: 09:00 PST is 17:00 UTC.
    const losAngeles = parseWhen("tomorrow at 9am", { now, timeZone: "America/Los_Angeles" });
    expect(losAngeles?.at.toISOString()).toBe("2026-03-05T17:00:00.000Z");
  });

  it("keeps the wall clock across a DST change", () => {
    // US clocks jump forward at 02:00 on 2026-03-08, so "tomorrow at 9am" asked
    // the evening before lands on the daylight-time side of the change: 16:00
    // UTC. Reusing today's standard-time offset would answer 17:00 UTC.
    const beforeChange = new Date("2026-03-07T18:00:00.000Z");
    const result = parseWhen("tomorrow at 9am", { now: beforeChange, timeZone: "America/Los_Angeles" });
    expect(result?.at.toISOString()).toBe("2026-03-08T16:00:00.000Z");

    // And it stays 9am local on the days either side of the change.
    const afterChange = new Date("2026-03-08T18:00:00.000Z");
    const next = parseWhen("tomorrow at 9am", { now: afterChange, timeZone: "America/Los_Angeles" });
    expect(next?.at.toISOString()).toBe("2026-03-09T16:00:00.000Z");
  });

  it("treats a relative offset the same in every zone", () => {
    const utc = parseWhen("in 2 hours", { now, timeZone: "UTC" });
    const sydney = parseWhen("in 2 hours", { now, timeZone: "Australia/Sydney" });
    expect(utc?.at.getTime()).toBe(sydney?.at.getTime());
  });

  it("falls back to UTC for an unrecognised zone", () => {
    expect(parseWhen("tomorrow at 9am", { now, timeZone: "Mars/Olympus" })?.at.toISOString()).toBe(
      "2026-03-05T09:00:00.000Z"
    );
  });

  it("formats durations for humans", () => {
    expect(formatDuration(90 * 60_000)).toBe("2 hours");
    expect(formatDuration(60_000)).toBe("1 minute");
  });
});
