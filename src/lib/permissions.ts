import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMembers, conversations, workspaceMembers } from "@/db/schema";
import { HttpError } from "./http";

export async function requireWorkspaceMember(workspaceId: string, userId: string) {
  const [member] = await db
    .select()
    .from(workspaceMembers)
    .where(and(
      eq(workspaceMembers.workspaceId, workspaceId),
      eq(workspaceMembers.userId, userId),
      eq(workspaceMembers.status, "active")
    ))
    .limit(1);

  if (!member) throw new HttpError(403, "Workspace access denied", "workspace_forbidden");
  return member;
}

export async function requireWorkspaceAdmin(workspaceId: string, userId: string) {
  const member = await requireWorkspaceMember(workspaceId, userId);
  if (member.role !== "owner" && member.role !== "admin") {
    throw new HttpError(403, "Admin access required", "admin_required");
  }
  return member;
}

export async function requireWorkspaceOwner(workspaceId: string, userId: string) {
  const member = await requireWorkspaceMember(workspaceId, userId);
  if (member.role !== "owner") throw new HttpError(403, "Owner access required", "owner_required");
  return member;
}

export async function requireConversationMember(conversationId: string, userId: string) {
  const [row] = await db
    .select({ conversation: conversations, member: conversationMembers })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(and(
      eq(conversationMembers.conversationId, conversationId),
      eq(conversationMembers.userId, userId),
      isNull(conversationMembers.leftAt)
    ))
    .limit(1);

  if (!row) throw new HttpError(403, "Conversation access denied", "conversation_forbidden");
  await requireWorkspaceMember(row.conversation.workspaceId, userId);
  return row;
}
