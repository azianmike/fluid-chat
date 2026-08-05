import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { users, workspaceMembers } from "@/db/schema";
import type { User } from "@/db/schema";
import { toWorkspace } from "@/lib/realtime";
import type { PresenceState } from "@/shared/types";
import { effectivePresence, toPublicUser } from "./serializers";

async function workspaceIdsFor(userId: string) {
  const rows = await db
    .select({ workspaceId: workspaceMembers.workspaceId })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active")));
  return rows.map((row) => row.workspaceId);
}

export async function broadcastPresence(user: User) {
  const workspaceIds = await workspaceIdsFor(user.id);
  const presence = effectivePresence(user);
  await Promise.all(workspaceIds.map((workspaceId) => toWorkspace(workspaceId, { type: "presence", userId: user.id, presence })));
  return presence;
}

export async function broadcastUserUpdate(user: User) {
  const workspaceIds = await workspaceIdsFor(user.id);
  await Promise.all(workspaceIds.map((workspaceId) => toWorkspace(workspaceId, { type: "user.updated", user: toPublicUser(user) })));
}

/** Called by the client on focus/activity; cheap enough to run every minute. */
export async function heartbeat(userId: string, presence: PresenceState = "active") {
  const [updated] = await db
    .update(users)
    .set({ lastActiveAt: new Date(), presence, updatedAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (updated) await broadcastPresence(updated);
  return updated;
}

export async function setPresence(userId: string, presence: PresenceState, dndUntil?: Date | null) {
  const [updated] = await db
    .update(users)
    .set({
      presence,
      dndUntil: dndUntil === undefined ? undefined : dndUntil,
      lastActiveAt: new Date(),
      updatedAt: new Date()
    })
    .where(eq(users.id, userId))
    .returning();
  await broadcastPresence(updated);
  return updated;
}

export async function setStatus(
  userId: string,
  status: { emoji?: string | null; text?: string | null; expiresAt?: Date | null }
) {
  const [updated] = await db
    .update(users)
    .set({
      statusEmoji: status.emoji ?? null,
      statusText: status.text ?? null,
      statusExpiresAt: status.expiresAt ?? null,
      updatedAt: new Date()
    })
    .where(eq(users.id, userId))
    .returning();
  await broadcastUserUpdate(updated);
  return updated;
}
