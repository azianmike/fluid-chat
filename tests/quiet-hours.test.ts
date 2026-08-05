import { describe, expect, it } from "vitest";
import { isWithinQuietHours } from "@/shared/quiet-hours";

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
