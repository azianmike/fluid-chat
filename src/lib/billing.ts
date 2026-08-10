import { and, count, eq, isNull, sum } from "drizzle-orm";
import { db } from "@/db/client";
import { files, users, workspaceInvites, workspaceMembers, workspaces } from "@/db/schema";
import { HttpError } from "./http";

/** 50MB. Storage is the one resource a free workspace can run up without limit. */
export const DEFAULT_STORAGE_LIMIT_BYTES = 50 * 1024 * 1024;

export async function workspaceUsage(workspaceId: string) {
  // Bot identities behind API keys hold memberships so permissions work, but a
  // seat is a person: they are not billed.
  const [activeMembers] = await db
    .select({ value: count() })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.status, "active"),
      eq(users.isBot, false)
    ));

  const [pendingInvites] = await db
    .select({ value: count() })
    .from(workspaceInvites)
    .where(and(
      eq(workspaceInvites.workspaceId, workspaceId),
      isNull(workspaceInvites.acceptedAt),
      isNull(workspaceInvites.revokedAt)
    ));

  return {
    activeMembers: activeMembers.value,
    pendingInvites: pendingInvites.value
  };
}

/** Split out so the upload transaction can run the same check on a row it already holds. */
export function assertWritable(workspace: { readOnlyAt: Date | null }) {
  if (workspace.readOnlyAt && workspace.readOnlyAt <= new Date()) {
    throw new HttpError(402, "Workspace is read-only because billing is past due", "workspace_read_only");
  }
}

export async function requireWorkspaceWritable(workspaceId: string) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw new HttpError(404, "Workspace not found", "not_found");
  assertWritable(workspace);
  return workspace;
}

/* -------------------------------------------------------------------------- */
/* Storage                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Resolves the byte ceiling for a workspace: the per-workspace column wins, then
 * the deployment-wide env default. `0` means unlimited at either level, matching
 * how FREE_WORKSPACE_LIMIT reads. Returns null for unlimited.
 */
export function resolveStorageLimitBytes(workspace: { storageLimitBytes: number | null }): number | null {
  const configured = workspace.storageLimitBytes;
  if (configured !== null && configured !== undefined) {
    return configured > 0 ? configured : null;
  }
  // Blank counts as unset, not as 0: `FOO=` is how operators clear a line, and
  // reading that as "unlimited" would silently switch the quota off entirely.
  const configuredEnv = process.env.WORKSPACE_STORAGE_LIMIT_BYTES?.trim();
  const fromEnv = Number(configuredEnv ? configuredEnv : DEFAULT_STORAGE_LIMIT_BYTES);
  if (!Number.isFinite(fromEnv) || fromEnv <= 0) return null;
  return fromEnv;
}

export type StorageQuota = {
  allowed: boolean;
  /** Clamped at 0, so a junk or empty sum can never read as negative usage. */
  usedBytes: number;
  limitBytes: number | null;
};

/**
 * The whole quota decision, as a pure function — it is what the tests exercise,
 * since everything around it needs a database.
 */
export function checkStorageQuota(input: {
  usedBytes: number;
  limitBytes: number | null;
  incomingBytes?: number;
  overageAllowed?: boolean;
}): StorageQuota {
  const usedBytes = Math.max(0, input.usedBytes);
  const limitBytes = input.limitBytes;
  const unlimited = limitBytes === null || input.overageAllowed === true;

  return {
    allowed: unlimited || usedBytes + Math.max(0, input.incomingBytes ?? 0) <= limitBytes,
    usedBytes,
    limitBytes
  };
}

/** Live bytes for a workspace. Soft-deleted files have already released their storage. */
export async function storageUsedBytes(workspaceId: string, executor: Pick<typeof db, "select"> = db) {
  const [row] = await executor
    .select({ bytes: sum(files.size) })
    .from(files)
    .where(and(eq(files.workspaceId, workspaceId), isNull(files.deletedAt)));
  // sum() is numeric, which node-postgres hands back as a string (or null when empty).
  return Number(row?.bytes ?? 0);
}

/** Usage for reporting. Enforcement runs its own check inside the upload transaction. */
export async function workspaceStorage(workspaceId: string) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw new HttpError(404, "Workspace not found", "not_found");
  return {
    usedBytes: await storageUsedBytes(workspaceId),
    limitBytes: resolveStorageLimitBytes(workspace)
  };
}

export async function enforceSeatLimit(workspaceId: string, additionalSeats = 1) {
  const workspace = await requireWorkspaceWritable(workspaceId);
  if (workspace.overageAllowed) return workspace;

  const usage = await workspaceUsage(workspaceId);
  if (usage.activeMembers + additionalSeats > workspace.seatLimit) {
    throw new HttpError(402, "Workspace seat limit reached", "seat_limit_reached");
  }

  return workspace;
}
