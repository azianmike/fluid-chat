import { describe, expect, it } from "vitest";
import { contentDisposition } from "@/server/services/files";

describe("file response headers", () => {
  it("keeps Unicode filenames out of the byte-valued fallback", () => {
    const header = contentDisposition("image/png", "Screenshot 2026-08-10 at 9.31.56\u202fPM.png");

    expect(header).toBe(
      "inline; filename=\"Screenshot 2026-08-10 at 9.31.56 PM.png\"; " +
      "filename*=UTF-8''Screenshot%202026-08-10%20at%209.31.56%E2%80%AFPM.png"
    );
    expect([...header].every((character) => character.charCodeAt(0) <= 0x7f)).toBe(true);
    expect(() => new Response(null, { headers: { "content-disposition": header } })).not.toThrow();
  });

  it("provides a readable ASCII fallback while preserving the UTF-8 name", () => {
    const header = contentDisposition("application/pdf", "r\u00e9sum\u00e9 (final)*.pdf");

    expect(header).toBe(
      "inline; filename=\"resume (final)*.pdf\"; filename*=UTF-8''r%C3%A9sum%C3%A9%20%28final%29%2A.pdf"
    );
  });

  it("neutralizes controls and path separators in both filename parameters", () => {
    const header = contentDisposition("application/octet-stream", "..\\report/quarter\r\n.txt");

    expect(header).toBe(
      "attachment; filename=\".._report_quarter__.txt\"; filename*=UTF-8''.._report_quarter__.txt"
    );
    expect(() => new Response(null, { headers: { "content-disposition": header } })).not.toThrow();
  });

  it("uses safe replacements for controls and a fallback for an empty name", () => {
    expect(contentDisposition("image/png", "\r\n")).toBe(
      "inline; filename=\"__\"; filename*=UTF-8''__"
    );
    expect(contentDisposition("image/svg+xml", "")).toBe(
      "attachment; filename=\"download\"; filename*=UTF-8''download"
    );
  });
});
