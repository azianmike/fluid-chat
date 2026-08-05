import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { channels, conversationMembers, conversations, workspaceMembers } from "@/db/schema";
import type { Channel, Conversation, ConversationMember, WorkspaceMember } from "@/db/schema";
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

export function isModerator(member: WorkspaceMember) {
  return member.role === "owner" || member.role === "admin";
}

export type ConversationAccess = {
  conversation: Conversation;
  channel: Channel | null;
  membership: ConversationMember | null;
  member: WorkspaceMember;
};

/**
 * Read access to a conversation. Public channels are previewable by any active
 * workspace member (as in Slack); everything else requires membership.
 */
export async function resolveConversationAccess(conversationId: string, userId: string): Promise<ConversationAccess> {
  const [row] = await db
    .select({ conversation: conversations, channel: channels })
    .from(conversations)
    .leftJoin(channels, eq(channels.id, conversations.channelId))
    .where(eq(conversations.id, conversationId))
    .limit(1);
  if (!row) throw new HttpError(404, "Conversation not found", "not_found");

  const member = await requireWorkspaceMember(row.conversation.workspaceId, userId);
  const [membership] = await db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, userId)))
    .limit(1);

  const joined = membership && !membership.leftAt;
  // Guests only ever see the conversations they were added to — no previewing
  // public channels the way full members can.
  const previewable = row.channel?.visibility === "public" && member.role !== "guest";
  if (!joined && !previewable) {
    throw new HttpError(403, "Conversation access denied", "conversation_forbidden");
  }

  return {
    conversation: row.conversation,
    channel: row.channel ?? null,
    membership: membership ?? null,
    member
  };
}

/** Write access: the caller must actually be in the conversation. */
export async function requireConversationMember(conversationId: string, userId: string) {
  const access = await resolveConversationAccess(conversationId, userId);
  if (!access.membership || access.membership.leftAt) {
    throw new HttpError(403, "Join this conversation first", "conversation_forbidden");
  }
  return access;
}

/** Posting in a public channel you are previewing joins you, like Slack does. */
export async function ensureConversationMembership(access: ConversationAccess, userId: string) {
  if (access.membership && !access.membership.leftAt) return access.membership;
  if (access.channel?.visibility !== "public") {
    throw new HttpError(403, "Join this conversation first", "conversation_forbidden");
  }
  const [membership] = await db
    .insert(conversationMembers)
    .values({
      workspaceId: access.conversation.workspaceId,
      conversationId: access.conversation.id,
      userId,
      lastReadAt: new Date()
    })
    .onConflictDoUpdate({
      target: [conversationMembers.conversationId, conversationMembers.userId],
      set: { leftAt: null, hiddenAt: null, joinedAt: new Date() }
    })
    .returning();
  return membership;
}
