import { describe, expect, it } from "vitest";
import { isWithinQuietHours, notificationsPaused } from "@/shared/quiet-hours";

const at = (iso: string) => new Date(iso);

describe("notification schedule", () => {
  it("is off when either bound is missing", () => {
    expect(isWithinQuietHours(null)).toBe(false);
    expect(isWithinQuietHours({ start: "22:00", end: null })).toBe(false);
    expect(isWithinQuietHours({ start: null, end: "08:00" })).toBe(false);
  });

  it("handles a window inside one day", () => {
    const quiet = { start: "09:00", end: "17:00" };
    expect(isWithinQuietHours(quiet, at("2026-03-04T12:00:00Z"), "UTC")).toBe(true);
    expect(isWithinQuietHours(quiet, at("2026-03-04T08:59:00Z"), "UTC")).toBe(false);
    expect(isWithinQuietHours(quiet, at("2026-03-04T17:00:00Z"), "UTC")).toBe(false);
  });

  it("wraps past midnight", () => {
    const quiet = { start: "22:00", end: "08:00" };
    expect(isWithinQuietHours(quiet, at("2026-03-04T23:30:00Z"), "UTC")).toBe(true);
    expect(isWithinQuietHours(quiet, at("2026-03-04T03:00:00Z"), "UTC")).toBe(true);
    expect(isWithinQuietHours(quiet, at("2026-03-04T12:00:00Z"), "UTC")).toBe(false);
  });

  it("evaluates in the person's own timezone", () => {
    const quiet = { start: "22:00", end: "08:00" };
    // 06:00 UTC is 23:00 the previous day in Los Angeles: quiet there, not in London.
    expect(isWithinQuietHours(quiet, at("2026-03-04T06:00:00Z"), "America/Los_Angeles")).toBe(true);
    expect(isWithinQuietHours(quiet, at("2026-03-04T13:00:00Z"), "Europe/London")).toBe(false);
  });

  it("ignores an empty window", () => {
    expect(isWithinQuietHours({ start: "09:00", end: "09:00" }, at("2026-03-04T09:00:00Z"), "UTC")).toBe(false);
  });
});

describe("notificationsPaused", () => {
  const now = at("2026-03-04T12:00:00Z");

  it("is off by default", () => {
    expect(notificationsPaused({}, now)).toBe(false);
  });

  it("follows the quiet-hours window in the person's timezone", () => {
    expect(notificationsPaused({ quietHours: { start: "09:00", end: "17:00" }, timeZone: "UTC" }, now)).toBe(true);
    expect(notificationsPaused({ quietHours: { start: "13:00", end: "17:00" }, timeZone: "UTC" }, now)).toBe(false);
  });

  it("pauses for an unexpired do-not-disturb", () => {
    expect(notificationsPaused({ dndUntil: "2026-03-04T13:00:00Z" }, now)).toBe(true);
  });

  it("resumes once do-not-disturb has expired", () => {
    expect(notificationsPaused({ dndUntil: "2026-03-04T11:59:00Z" }, now)).toBe(false);
    expect(notificationsPaused({ dndUntil: null }, now)).toBe(false);
  });

  it("pauses on either reason alone", () => {
    const outsideQuietHours = { start: "22:00", end: "08:00" };
    expect(
      notificationsPaused({ quietHours: outsideQuietHours, timeZone: "UTC", dndUntil: "2026-03-04T13:00:00Z" }, now)
    ).toBe(true);
  });
});
