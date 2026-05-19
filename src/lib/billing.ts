import { and, count, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { workspaceInvites, workspaceMembers, workspaces } from "@/db/schema";
import { HttpError } from "./http";

export async function workspaceUsage(workspaceId: string) {
  const [activeMembers] = await db
    .select({ value: count() })
    .from(workspaceMembers)
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active")));

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

export async function requireWorkspaceWritable(workspaceId: string) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw new HttpError(404, "Workspace not found", "not_found");
  if (workspace.readOnlyAt && workspace.readOnlyAt <= new Date()) {
    throw new HttpError(402, "Workspace is read-only because billing is past due", "workspace_read_only");
  }
  return workspace;
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
