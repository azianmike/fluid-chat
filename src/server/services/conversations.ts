import { and, count, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  channels,
  conversationMembers,
  conversations,
  messages,
  users,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import type { Channel, Conversation, User } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { requireWorkspaceMember } from "@/lib/permissions";
import { requireWorkspaceWritable } from "@/lib/billing";
import { normalizeChannelName } from "@/lib/security";
import { toUsers, toWorkspace } from "@/lib/realtime";
import type { ChannelSummary, ConversationSummary } from "@/shared/types";
import { toChannelSummary, toConversationSummary } from "./serializers";
import { conversationActivity } from "./unread";
import { postSystemMessage } from "./messages";

/* -------------------------------------------------------------------------- */
/* Channels                                                                    */
/* -------------------------------------------------------------------------- */

export async function createChannel(options: {
  workspaceId: string;
  actor: User;
  name: string;
  visibility: "public" | "private";
  description?: string | null;
  topic?: string | null;
  memberIds?: string[];
}) {
  const member = await requireWorkspaceMember(options.workspaceId, options.actor.id);
  const workspace = await requireWorkspaceWritable(options.workspaceId);
  const privileged = member.role === "owner" || member.role === "admin";
  if (member.role === "guest") {
    throw new HttpError(403, "Guests cannot create channels", "channel_creation_restricted");
  }
  if (!workspace.membersCanCreateChannels && !privileged) {
    throw new HttpError(403, "Only admins can create channels in this workspace", "channel_creation_restricted");
  }

  const name = normalizeChannelName(options.name);
  if (!name) throw new HttpError(400, "Invalid channel name", "invalid_channel_name");

  const result = await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: channels.id })
      .from(channels)
      .where(and(eq(channels.workspaceId, options.workspaceId), eq(channels.name, name)))
      .limit(1);
    if (existing) throw new HttpError(409, "Channel name already exists", "duplicate_channel_name");

    const requestedMemberIds = Array.from(new Set([options.actor.id, ...(options.memberIds ?? [])]));
    const activeMembers = await tx
      .select({ userId: workspaceMembers.userId })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.workspaceId, options.workspaceId),
          eq(workspaceMembers.status, "active"),
          inArray(workspaceMembers.userId, requestedMemberIds)
        )
      );
    if (activeMembers.length !== requestedMemberIds.length) {
      throw new HttpError(400, "All channel members must be active workspace members", "invalid_channel_members");
    }

    const [channel] = await tx
      .insert(channels)
      .values({
        workspaceId: options.workspaceId,
        name,
        visibility: options.visibility,
        description: options.description ?? null,
        topic: options.topic ?? null,
        createdByUserId: options.actor.id
      })
      .returning();

    const [conversation] = await tx
      .insert(conversations)
      .values({
        workspaceId: options.workspaceId,
        type: "channel",
        channelId: channel.id,
        createdByUserId: options.actor.id
      })
      .returning();

    await tx.insert(conversationMembers).values(
      activeMembers.map((entry) => ({
        workspaceId: options.workspaceId,
        conversationId: conversation.id,
        userId: entry.userId,
        role: entry.userId === options.actor.id ? "creator" : null,
        lastReadAt: new Date()
      }))
    );

    return { channel, conversation, memberIds: activeMembers.map((entry) => entry.userId) };
  });

  await postSystemMessage({
    conversation: result.conversation,
    actor: options.actor,
    type: "system",
    bodyText: `<@${options.actor.id}> created this channel.`,
    metadata: { event: "channel_created" }
  });
  await toWorkspace(options.workspaceId, { type: "channel.created", channelId: result.channel.id });

  return result;
}

export async function joinChannel(channel: Channel, conversation: Conversation, user: User) {
  if (channel.archivedAt) throw new HttpError(400, "Archived channels cannot be joined", "channel_archived");
  if (channel.visibility !== "public") throw new HttpError(403, "Private channels are invite-only", "private_channel");

  const [existing] = await db
    .select()
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, user.id)))
    .limit(1);

  await db
    .insert(conversationMembers)
    .values({
      workspaceId: channel.workspaceId,
      conversationId: conversation.id,
      userId: user.id,
      lastReadAt: new Date()
    })
    .onConflictDoUpdate({
      target: [conversationMembers.conversationId, conversationMembers.userId],
      set: { leftAt: null, hiddenAt: null, joinedAt: new Date() }
    });

  if (!existing || existing.leftAt) {
    await postSystemMessage({
      conversation,
      actor: user,
      type: "join",
      bodyText: `<@${user.id}> joined the channel.`
    });
  }
  await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
}

export async function addChannelMembers(options: {
  channel: Channel;
  conversation: Conversation;
  actor: User;
  userIds: string[];
}) {
  const valid = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, options.channel.workspaceId),
        eq(workspaceMembers.status, "active"),
        inArray(workspaceMembers.userId, options.userIds)
      )
    );
  if (valid.length === 0) return [];

  await db
    .insert(conversationMembers)
    .values(
      valid.map((entry) => ({
        workspaceId: options.channel.workspaceId,
        conversationId: options.conversation.id,
        userId: entry.userId,
        lastReadAt: new Date()
      }))
    )
    .onConflictDoUpdate({
      target: [conversationMembers.conversationId, conversationMembers.userId],
      set: { leftAt: null, hiddenAt: null, joinedAt: new Date() }
    });

  await postSystemMessage({
    conversation: options.conversation,
    actor: options.actor,
    type: "join",
    bodyText: `<@${options.actor.id}> added ${valid.map((entry) => `<@${entry.userId}>`).join(" ")} to the channel.`
  });
  await toUsers(
    valid.map((entry) => entry.userId),
    { type: "conversation.updated", conversationId: options.conversation.id }
  );
  return valid.map((entry) => entry.userId);
}

export async function leaveChannel(channel: Channel, conversation: Conversation, user: User) {
  if (channel.autoJoin && channel.name === "general") {
    throw new HttpError(400, "Cannot leave the default channel", "required_channel");
  }
  await db
    .update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, user.id)));
  await postSystemMessage({
    conversation,
    actor: user,
    type: "leave",
    bodyText: `<@${user.id}> left the channel.`
  });
}

/* -------------------------------------------------------------------------- */
/* Direct messages                                                             */
/* -------------------------------------------------------------------------- */

function memberKeyFor(userIds: string[]) {
  return [...new Set(userIds)].sort().join(":");
}

/**
 * Opens (or reuses) a DM or group DM. The deterministic `member_key` plus a
 * unique index means concurrent opens can never create duplicates.
 */
export async function openDirectConversation(options: { workspaceId: string; actor: User; userIds: string[] }) {
  const participantIds = Array.from(new Set([options.actor.id, ...options.userIds]));
  if (participantIds.length < 2) throw new HttpError(400, "Pick at least one other person", "invalid_dm");
  if (participantIds.length > 9) throw new HttpError(400, "Group messages support up to 9 people", "dm_too_large");

  await requireWorkspaceWritable(options.workspaceId);
  const members = await db
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, options.workspaceId),
        eq(workspaceMembers.status, "active"),
        inArray(workspaceMembers.userId, participantIds)
      )
    );
  if (members.length !== participantIds.length) {
    throw new HttpError(400, "Everyone in a conversation must be an active member", "invalid_dm_members");
  }

  const memberKey = memberKeyFor(participantIds);
  const [existing] = await db
    .select()
    .from(conversations)
    .where(and(eq(conversations.workspaceId, options.workspaceId), eq(conversations.memberKey, memberKey)))
    .limit(1);

  if (existing) {
    await db
      .update(conversationMembers)
      .set({ leftAt: null, hiddenAt: null })
      .where(
        and(
          eq(conversationMembers.conversationId, existing.id),
          inArray(conversationMembers.userId, participantIds)
        )
      );
    return existing;
  }

  const conversation = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(conversations)
      .values({
        workspaceId: options.workspaceId,
        type: participantIds.length === 2 ? "dm" : "group_dm",
        memberKey,
        createdByUserId: options.actor.id
      })
      .returning();
    await tx.insert(conversationMembers).values(
      participantIds.map((userId) => ({
        workspaceId: options.workspaceId,
        conversationId: created.id,
        userId,
        lastReadAt: userId === options.actor.id ? new Date() : null
      }))
    );
    return created;
  });

  await toUsers(participantIds, { type: "conversation.updated", conversationId: conversation.id });
  return conversation;
}

/* -------------------------------------------------------------------------- */
/* Listing                                                                     */
/* -------------------------------------------------------------------------- */

export async function listSidebarConversations(workspaceId: string, userId: string): Promise<ConversationSummary[]> {
  const rows = await db
    .select({ conversation: conversations, channel: channels, membership: conversationMembers })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .leftJoin(channels, eq(channels.id, conversations.channelId))
    .where(
      and(
        eq(conversationMembers.workspaceId, workspaceId),
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.leftAt),
        or(isNull(conversations.channelId), isNull(channels.archivedAt))
      )
    )
    .orderBy(desc(conversations.lastMessageAt));

  const conversationIds = rows.map((row) => row.conversation.id);
  const [activity, memberRows] = await Promise.all([
    conversationActivity(conversationIds, userId),
    conversationIds.length > 0
      ? db
          .select({ conversationId: conversationMembers.conversationId, userId: conversationMembers.userId })
          .from(conversationMembers)
          .where(
            and(
              inArray(conversationMembers.conversationId, conversationIds),
              isNull(conversationMembers.leftAt)
            )
          )
      : []
  ]);

  const membersByConversation = new Map<string, string[]>();
  for (const row of memberRows) {
    membersByConversation.set(row.conversationId, [...(membersByConversation.get(row.conversationId) ?? []), row.userId]);
  }

  return rows.map((row) =>
    toConversationSummary({
      conversation: row.conversation,
      channel: row.channel,
      membership: row.membership,
      memberIds: membersByConversation.get(row.conversation.id) ?? [],
      unreadCount: activity.get(row.conversation.id)?.unreadCount ?? 0,
      mentionCount: activity.get(row.conversation.id)?.mentionCount ?? 0,
      memberCount: (membersByConversation.get(row.conversation.id) ?? []).length
    })
  );
}

/** Channel browser: every channel the user is allowed to see. */
export async function listChannelDirectory(options: {
  workspaceId: string;
  userId: string;
  includeArchived?: boolean;
  query?: string;
  /** Guests see only their own channels, never the public directory. */
  membersOnly?: boolean;
}): Promise<Array<ChannelSummary & { conversationId: string; joined: boolean }>> {
  const rows = await db
    .select({ channel: channels, conversation: conversations, membership: conversationMembers })
    .from(channels)
    .innerJoin(conversations, eq(conversations.channelId, channels.id))
    .leftJoin(
      conversationMembers,
      and(
        eq(conversationMembers.conversationId, conversations.id),
        eq(conversationMembers.userId, options.userId),
        isNull(conversationMembers.leftAt)
      )
    )
    .where(
      and(
        eq(channels.workspaceId, options.workspaceId),
        options.includeArchived ? undefined : isNull(channels.archivedAt),
        options.membersOnly
          ? eq(conversationMembers.userId, options.userId)
          : or(eq(channels.visibility, "public"), eq(conversationMembers.userId, options.userId)),
        options.query ? sql`${channels.name} ilike ${`%${options.query}%`}` : undefined
      )
    )
    .orderBy(channels.name);

  const counts = await db
    .select({ conversationId: conversationMembers.conversationId, value: count() })
    .from(conversationMembers)
    .where(
      and(
        eq(conversationMembers.workspaceId, options.workspaceId),
        isNull(conversationMembers.leftAt),
        rows.length > 0 ? inArray(conversationMembers.conversationId, rows.map((row) => row.conversation.id)) : sql`false`
      )
    )
    .groupBy(conversationMembers.conversationId);
  const countByConversation = new Map(counts.map((row) => [row.conversationId, row.value]));

  return rows.map((row) => ({
    ...toChannelSummary(row.channel, countByConversation.get(row.conversation.id) ?? 0),
    conversationId: row.conversation.id,
    joined: !!row.membership
  }));
}

export async function conversationMemberList(conversationId: string) {
  return db
    .select({ member: conversationMembers, user: users })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
}

/** Title used in notifications and search results. */
export async function conversationLabel(conversation: Conversation, viewerId: string) {
  if (conversation.channelId) {
    const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId)).limit(1);
    return channel ? `#${channel.name}` : "channel";
  }
  const others = await db
    .select({ displayName: users.displayName })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversation.id), ne(conversationMembers.userId, viewerId)));
  return others.map((row) => row.displayName).join(", ") || "Direct message";
}

export async function defaultWorkspaceConversation(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ conversation: conversations })
    .from(conversationMembers)
    .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
    .where(
      and(
        eq(conversationMembers.workspaceId, workspaceId),
        eq(conversationMembers.userId, userId),
        isNull(conversationMembers.leftAt)
      )
    )
    .orderBy(desc(conversations.lastMessageAt))
    .limit(1);
  return row?.conversation ?? null;
}

export async function workspaceById(workspaceId: string) {
  const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
  if (!workspace) throw new HttpError(404, "Workspace not found", "not_found");
  return workspace;
}

export async function latestMessageId(conversationId: string) {
  const [row] = await db
    .select({ id: messages.id })
    .from(messages)
    .where(eq(messages.conversationId, conversationId))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return row?.id ?? null;
}
