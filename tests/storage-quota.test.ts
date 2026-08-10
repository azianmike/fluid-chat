import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_STORAGE_LIMIT_BYTES, checkStorageQuota, resolveStorageLimitBytes } from "@/lib/billing";

const MB = 1024 * 1024;

afterEach(() => {
  delete process.env.WORKSPACE_STORAGE_LIMIT_BYTES;
});

describe("resolveStorageLimitBytes", () => {
  it("defaults to 50MB when nothing is configured", () => {
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
    expect(DEFAULT_STORAGE_LIMIT_BYTES).toBe(50 * MB);
  });

  it("lets the deployment override the default", () => {
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = String(200 * MB);
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBe(200 * MB);
  });

  it("prefers the per-workspace column over the env default", () => {
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = String(50 * MB);
    expect(resolveStorageLimitBytes({ storageLimitBytes: 5 * 1024 * MB })).toBe(5 * 1024 * MB);
  });

  it("treats zero as unlimited at either level", () => {
    expect(resolveStorageLimitBytes({ storageLimitBytes: 0 })).toBeNull();
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = "0";
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBeNull();
  });

  it("treats a blank env value as unset, not as unlimited", () => {
    // `WORKSPACE_STORAGE_LIMIT_BYTES=` is how an operator clears a line; reading
    // it as 0 would switch every workspace's quota off without a word.
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = "";
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = "   ";
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBe(DEFAULT_STORAGE_LIMIT_BYTES);
  });

  it("still honours an explicit zero as unlimited", () => {
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = "0";
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBeNull();
  });

  it("falls back to unlimited rather than zero when the env value is junk", () => {
    process.env.WORKSPACE_STORAGE_LIMIT_BYTES = "not-a-number";
    expect(resolveStorageLimitBytes({ storageLimitBytes: null })).toBeNull();
  });
});

describe("checkStorageQuota", () => {
  it("allows an upload that fits", () => {
    expect(checkStorageQuota({ usedBytes: 10 * MB, limitBytes: 50 * MB, incomingBytes: 5 * MB }).allowed).toBe(true);
  });

  it("allows an upload that lands exactly on the limit", () => {
    expect(checkStorageQuota({ usedBytes: 45 * MB, limitBytes: 50 * MB, incomingBytes: 5 * MB }).allowed).toBe(true);
  });

  it("rejects the upload that would cross the limit, not the one that reached it", () => {
    expect(checkStorageQuota({ usedBytes: 50 * MB, limitBytes: 50 * MB, incomingBytes: 1 }).allowed).toBe(false);
    expect(checkStorageQuota({ usedBytes: 48 * MB, limitBytes: 50 * MB, incomingBytes: 3 * MB }).allowed).toBe(false);
  });

  it("blocks a workspace already over a limit that was lowered under its usage", () => {
    const quota = checkStorageQuota({ usedBytes: 80 * MB, limitBytes: 50 * MB, incomingBytes: 1 });
    expect(quota.allowed).toBe(false);
    // Reported honestly rather than clamped to the limit, so the admin sees the overage.
    expect(quota.usedBytes).toBe(80 * MB);
  });

  it("waves through workspaces allowed to run an overage", () => {
    const quota = checkStorageQuota({ usedBytes: 80 * MB, limitBytes: 50 * MB, incomingBytes: 20 * MB, overageAllowed: true });
    expect(quota.allowed).toBe(true);
    expect(quota.limitBytes).toBe(50 * MB);
  });

  it("waves through an unlimited workspace and reports no ceiling", () => {
    const quota = checkStorageQuota({ usedBytes: 900 * MB, limitBytes: null, incomingBytes: 100 * MB });
    expect(quota.allowed).toBe(true);
    expect(quota.limitBytes).toBeNull();
  });

  it("clamps a negative or empty sum to zero", () => {
    // storageUsedBytes coerces sum()'s null (no rows) to 0 before it gets here.
    const empty: string | null = null;
    expect(checkStorageQuota({ usedBytes: Number(empty ?? 0), limitBytes: 50 * MB, incomingBytes: MB })).toMatchObject({
      allowed: true,
      usedBytes: 0
    });
    expect(checkStorageQuota({ usedBytes: -5, limitBytes: 50 * MB }).usedBytes).toBe(0);
  });
});
