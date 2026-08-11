import { describe, expect, it } from "vitest";
import {
  assertFileUploadAllowed,
  FILE_RETENTION_MS,
  fileExpiresAt,
  MAX_UPLOAD_BYTES,
  MAX_WORKSPACE_FILE_BYTES
} from "@/server/services/file-policy";
import { contentDisposition } from "@/server/services/files";
import { buildStorageKey } from "@/server/services/storage";

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

describe("file storage policy", () => {
  it("allows the exact per-file and workspace limits", () => {
    expect(() => assertFileUploadAllowed(MAX_UPLOAD_BYTES)).not.toThrow();
    expect(() =>
      assertFileUploadAllowed(MAX_UPLOAD_BYTES, MAX_WORKSPACE_FILE_BYTES - MAX_UPLOAD_BYTES)
    ).not.toThrow();
  });

  it("rejects files over 10MB and workspace usage over 100MB", () => {
    expect(() => assertFileUploadAllowed(MAX_UPLOAD_BYTES + 1)).toThrowError(
      expect.objectContaining({ status: 413, code: "file_too_large" })
    );
    expect(() => assertFileUploadAllowed(1, MAX_WORKSPACE_FILE_BYTES)).toThrowError(
      expect.objectContaining({ status: 413, code: "workspace_storage_limit" })
    );
  });

  it("expires files exactly 15 days after creation", () => {
    const createdAt = new Date("2026-08-11T12:34:56.000Z");
    expect(fileExpiresAt(createdAt).getTime() - createdAt.getTime()).toBe(FILE_RETENTION_MS);
  });

  it("creates isolated, sanitized S3 object keys", () => {
    const key = buildStorageKey("43618e88-2b92-4301-a825-429900a50615", "../../report?.pdf");
    expect(key).toMatch(
      /^files\/43618e88-2b92-4301-a825-429900a50615\/[0-9a-f-]{36}-\.\._\.\._report_\.pdf$/
    );
    expect(key).not.toContain("../");
  });
});
