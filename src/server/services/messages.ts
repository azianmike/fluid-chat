import { and, asc, desc, eq, gt, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  channels,
  conversationMembers,
  conversations,
  files,
  linkPreviews,
  messagePins,
  messageReactions,
  messages,
  savedItems,
  users
} from "@/db/schema";
import type { Conversation, Message, User } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { toConversation, toUsers } from "@/lib/realtime";
import { toPlainText } from "@/shared/markdown";
import { groupReactions, withReacted } from "@/shared/reactions";
import type { MessageDto, ReactionGroup } from "@/shared/types";
import { requireWorkspaceMember } from "@/lib/permissions";
import { requireWorkspaceWritable } from "@/lib/billing";
import { deliverableRecipients, keywordRecipients, notify } from "./notifications";
import { resolveMentionedUserIds } from "./mentions";
import { followedThreadIds, threadFollowersFor } from "./threads";
import { toFileSummary, toIso } from "./serializers";

export const MESSAGE_PAGE_SIZE = 50;

/* -------------------------------------------------------------------------- */
/* Reactions                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Reaction groups for a single message, with no viewer baked in. Realtime
 * broadcasts must use this rather than a summary built for whoever clicked:
 * that user's `reacted` flag would land on every other client in the room and
 * light up the chip as theirs.
 */
export async function messageReactionGroups(messageId: string): Promise<ReactionGroup[]> {
  const rows = await db
    .select({ emoji: messageReactions.emoji, id: messageReactions.userId, displayName: users.displayName })
    .from(messageReactions)
    .innerJoin(users, eq(users.id, messageReactions.userId))
    .where(eq(messageReactions.messageId, messageId))
    .orderBy(asc(messageReactions.createdAt));
  return rows.reduce(groupReactions, [] as ReactionGroup[]);
}

/* -------------------------------------------------------------------------- */
/* Hydration                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Turns message rows into client-ready DTOs with reactions, files, pins, saved
 * state and thread stats resolved in a fixed number of queries regardless of
 * how many messages are being rendered.
 */
export async function hydrateMessages(rows: Message[], viewerId: string): Promise<MessageDto[]> {
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);

  const [reactionRows, fileRows, pinRows, savedRows, previewRows, threadStats, threadParticipants, following] = await Promise.all([
    db
      .select({
        messageId: messageReactions.messageId,
        emoji: messageReactions.emoji,
        id: messageReactions.userId,
        displayName: users.displayName
      })
      .from(messageReactions)
      .innerJoin(users, eq(users.id, messageReactions.userId))
      .where(inArray(messageReactions.messageId, ids))
      .orderBy(asc(messageReactions.createdAt)),
    db
      .select()
      .from(files)
      .where(and(inArray(files.messageId, ids), isNull(files.deletedAt), gt(files.expiresAt, new Date()))),
    db.select({ messageId: messagePins.messageId }).from(messagePins).where(inArray(messagePins.messageId, ids)),
    db
      .select({ messageId: savedItems.messageId })
      .from(savedItems)
      .where(and(inArray(savedItems.messageId, ids), eq(savedItems.userId, viewerId))),
    db.select().from(linkPreviews).where(inArray(linkPreviews.messageId, ids)),
    db
      .select({
        parentMessageId: messages.parentMessageId,
        replyCount: sql<number>`count(*)::int`,
        lastReplyAt: sql<string | null>`max(${messages.createdAt})`
      })
      .from(messages)
      .where(and(inArray(messages.parentMessageId, ids), isNull(messages.deletedAt)))
      .groupBy(messages.parentMessageId),
    db
      .selectDistinct({ parentMessageId: messages.parentMessageId, senderId: messages.senderId })
      .from(messages)
      .where(inArray(messages.parentMessageId, ids)),
    followedThreadIds(
      rows.map((row) => ({ id: row.id, senderId: row.senderId })),
      viewerId
    )
  ]);

  const reactions = new Map<string, ReactionGroup[]>();
  for (const row of reactionRows) {
    const list = reactions.get(row.messageId) ?? [];
    reactions.set(row.messageId, groupReactions(list, row));
  }

  const filesByMessage = new Map<string, ReturnType<typeof toFileSummary>[]>();
  for (const file of fileRows) {
    if (!file.messageId) continue;
    filesByMessage.set(file.messageId, [...(filesByMessage.get(file.messageId) ?? []), toFileSummary(file)]);
  }

  const previewsByMessage = new Map<string, MessageDto["links"]>();
  for (const preview of previewRows) {
    previewsByMessage.set(preview.messageId, [
      ...(previewsByMessage.get(preview.messageId) ?? []),
      {
        url: preview.url,
        title: preview.title,
        description: preview.description,
        imageUrl: preview.imageUrl,
        siteName: preview.siteName
      }
    ]);
  }

  const participants = new Map<string, string[]>();
  for (const row of threadParticipants) {
    if (!row.parentMessageId) continue;
    participants.set(row.parentMessageId, [...(participants.get(row.parentMessageId) ?? []), row.senderId]);
  }

  const stats = new Map(threadStats.filter((stat) => stat.parentMessageId).map((stat) => [stat.parentMessageId as string, stat]));
  const pinned = new Set(pinRows.map((row) => row.messageId));
  const saved = new Set(savedRows.map((row) => row.messageId));

  return rows.map((row) => ({
    id: row.id,
    workspaceId: row.workspaceId,
    conversationId: row.conversationId,
    senderId: row.senderId,
    parentMessageId: row.parentMessageId,
    clientMessageId: row.clientMessageId,
    type: row.type,
    bodyText: row.deletedAt ? "" : row.bodyText,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    threadBroadcast: row.threadBroadcast,
    editedAt: toIso(row.editedAt),
    deletedAt: toIso(row.deletedAt),
    createdAt: new Date(row.createdAt).toISOString(),
    reactions: row.deletedAt ? [] : withReacted(reactions.get(row.id) ?? [], viewerId),
    files: row.deletedAt ? [] : filesByMessage.get(row.id) ?? [],
    links: row.deletedAt ? [] : previewsByMessage.get(row.id) ?? [],
    thread: {
      replyCount: stats.get(row.id)?.replyCount ?? 0,
      lastReplyAt: stats.get(row.id)?.lastReplyAt ? new Date(stats.get(row.id)!.lastReplyAt as string).toISOString() : null,
      participantIds: Array.from(new Set(participants.get(row.id) ?? [])),
      following: following.has(row.id)
    },
    pinned: pinned.has(row.id),
    saved: saved.has(row.id)
  }));
}

export async function hydrateMessageById(messageId: string, viewerId: string) {
  const [row] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!row) throw new HttpError(404, "Message not found", "not_found");
  const [dto] = await hydrateMessages([row], viewerId);
  return dto;
}

/* -------------------------------------------------------------------------- */
/* Reading                                                                     */
/* -------------------------------------------------------------------------- */

export async function listConversationMessages(options: {
  conversationId: string;
  viewerId: string;
  before?: string;
  after?: string;
  limit?: number;
}) {
  const limit = Math.min(options.limit ?? MESSAGE_PAGE_SIZE, 200);
  const beforeDate = options.before ? new Date(options.before) : null;
  const afterDate = options.after ? new Date(options.after) : null;

  const rows = await db
    .select()
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, options.conversationId),
        // Thread replies only appear in the main view when explicitly broadcast.
        sql`(${messages.parentMessageId} is null or ${messages.threadBroadcast} = true)`,
        beforeDate ? lt(messages.createdAt, beforeDate) : undefined,
        afterDate ? gt(messages.createdAt, afterDate) : undefined
      )
    )
    .orderBy(afterDate ? asc(messages.createdAt) : desc(messages.createdAt))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = rows.slice(0, limit);
  const ordered = afterDate ? page : page.reverse();
  return { messages: await hydrateMessages(ordered, options.viewerId), hasMore };
}

export async function listThreadMessages(parentMessageId: string, viewerId: string) {
  const rows = await db
    .select()
    .from(messages)
    .where(sql`${messages.id} = ${parentMessageId} or ${messages.parentMessageId} = ${parentMessageId}`)
    .orderBy(asc(messages.createdAt));
  return hydrateMessages(rows, viewerId);
}

/* -------------------------------------------------------------------------- */
/* Writing                                                                     */
/* -------------------------------------------------------------------------- */

export async function assertCanPost(conversation: Conversation, userId: string) {
  await requireWorkspaceWritable(conversation.workspaceId);
  if (!conversation.channelId) return;
  const [channel] = await db.select().from(channels).where(eq(channels.id, conversation.channelId)).limit(1);
  if (!channel) return;
  if (channel.archivedAt) throw new HttpError(400, "This channel is archived and read-only", "channel_archived");
  if (channel.postingPolicy === "admins") {
    const member = await requireWorkspaceMember(conversation.workspaceId, userId);
    if (member.role !== "owner" && member.role !== "admin") {
      throw new HttpError(403, "Only admins can post in this channel", "posting_restricted");
    }
  }
}

export type CreateMessageInput = {
  conversation: Conversation;
  sender: User;
  bodyText: string;
  clientMessageId?: string | null;
  parentMessageId?: string | null;
  threadBroadcast?: boolean;
  fileIds?: string[];
  type?: Message["type"];
  metadata?: Record<string, unknown> | null;
  skipNotifications?: boolean;
  /** Set for messages whose payload is an attachment or a shared message. */
  allowEmpty?: boolean;
};

export async function createMessage(input: CreateMessageInput): Promise<MessageDto> {
  const { conversation, sender } = input;
  const bodyText = input.bodyText.trim();
  const fileIds = input.fileIds ?? [];
  if (!bodyText && fileIds.length === 0 && !input.allowEmpty) {
    throw new HttpError(400, "Message cannot be empty", "empty_message");
  }

  if (input.parentMessageId) {
    const [parent] = await db
      .select({ id: messages.id, conversationId: messages.conversationId, parentMessageId: messages.parentMessageId })
      .from(messages)
      .where(eq(messages.id, input.parentMessageId))
      .limit(1);
    if (!parent || parent.conversationId !== conversation.id) {
      throw new HttpError(400, "Thread parent must be in the same conversation", "invalid_thread_parent");
    }
    if (parent.parentMessageId) {
      throw new HttpError(400, "Threads cannot be nested", "nested_thread");
    }
  }

  const [inserted] = await db
    .insert(messages)
    .values({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      senderId: sender.id,
      parentMessageId: input.parentMessageId ?? null,
      clientMessageId: input.clientMessageId ?? null,
      type: input.type ?? "user",
      bodyText,
      threadBroadcast: input.threadBroadcast ?? false,
      metadata: input.metadata ?? null
    })
    .onConflictDoNothing()
    .returning();

  // A retried send with the same client id resolves to the original message.
  const message =
    inserted ??
    (input.clientMessageId
      ? (
          await db
            .select()
            .from(messages)
            .where(and(eq(messages.senderId, sender.id), eq(messages.clientMessageId, input.clientMessageId)))
            .limit(1)
        )[0]
      : undefined);
  if (!message) throw new HttpError(409, "Duplicate message", "duplicate_message");
  if (!inserted) return (await hydrateMessages([message], sender.id))[0];

  if (fileIds.length > 0) {
    await db
      .update(files)
      .set({ messageId: message.id, conversationId: conversation.id })
      .where(
        and(
          inArray(files.id, fileIds),
          eq(files.uploaderId, sender.id),
          eq(files.workspaceId, conversation.workspaceId),
          isNull(files.messageId),
          isNull(files.deletedAt),
          gt(files.expiresAt, new Date())
        )
      );
  }

  await db
    .update(conversations)
    .set({ lastMessageAt: message.createdAt, updatedAt: new Date() })
    .where(eq(conversations.id, conversation.id));

  // Re-open the conversation for anybody who had closed it in their sidebar.
  await db
    .update(conversationMembers)
    .set({ hiddenAt: null })
    .where(and(eq(conversationMembers.conversationId, conversation.id), sql`${conversationMembers.hiddenAt} is not null`));

  const [dto] = await hydrateMessages([message], sender.id);

  if (!input.skipNotifications && message.type === "user") {
    await fanOutMessageNotifications({ conversation, sender, message });
  }

  const memberIds = await conversationMemberIds(conversation.id);
  await Promise.all([
    toConversation(conversation.id, { type: "message.created", conversationId: conversation.id, message: dto }),
    toUsers(memberIds, { type: "conversation.updated", conversationId: conversation.id })
  ]);

  return dto;
}

async function fanOutMessageNotifications(options: { conversation: Conversation; sender: User; message: Message }) {
  const { conversation, sender, message } = options;
  const preview = toPlainText(message.bodyText).slice(0, 280);

  const { userIds: mentionedIds } = await resolveMentionedUserIds({
    workspaceId: conversation.workspaceId,
    conversationId: conversation.id,
    senderId: sender.id,
    bodyText: message.bodyText
  });

  const notified = new Set<string>();

  if (mentionedIds.length > 0) {
    const allowed = await deliverableRecipients({
      conversationId: conversation.id,
      excludeUserId: sender.id,
      mentioned: true
    });
    const targets = mentionedIds.filter((id) => allowed.includes(id));
    targets.forEach((id) => notified.add(id));
    await notify({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      actorUserId: sender.id,
      type: "mention",
      body: preview,
      userIds: targets
    });
  }

  if (conversation.type === "dm" || conversation.type === "group_dm") {
    const recipients = (
      await deliverableRecipients({ conversationId: conversation.id, excludeUserId: sender.id })
    ).filter((id) => !notified.has(id));
    recipients.forEach((id) => notified.add(id));
    await notify({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      actorUserId: sender.id,
      type: "dm",
      body: preview,
      userIds: recipients
    });
  }

  if (message.parentMessageId) {
    // Everyone taking part follows by default; explicit follow/unfollow wins.
    const followers = await threadFollowersFor(message.parentMessageId);
    const allowed = await deliverableRecipients({ conversationId: conversation.id, excludeUserId: sender.id });
    const targets = followers.filter((id) => id !== sender.id && allowed.includes(id) && !notified.has(id));
    targets.forEach((id) => notified.add(id));
    await notify({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      actorUserId: sender.id,
      type: "thread_reply",
      body: preview,
      userIds: targets
    });
  }

  const keywordTargets = (
    await keywordRecipients(conversation.workspaceId, conversation.id, message.bodyText, sender.id)
  ).filter((id) => !notified.has(id));
  if (keywordTargets.length > 0) {
    await notify({
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
      messageId: message.id,
      actorUserId: sender.id,
      type: "keyword",
      body: preview,
      userIds: keywordTargets
    });
  }
}

export async function conversationMemberIds(conversationId: string) {
  const rows = await db
    .select({ userId: conversationMembers.userId })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));
  return rows.map((row) => row.userId);
}

export async function postSystemMessage(options: {
  conversation: Conversation;
  actor: User;
  type: Message["type"];
  bodyText: string;
  metadata?: Record<string, unknown>;
}) {
  const [message] = await db
    .insert(messages)
    .values({
      workspaceId: options.conversation.workspaceId,
      conversationId: options.conversation.id,
      senderId: options.actor.id,
      type: options.type,
      bodyText: options.bodyText,
      metadata: options.metadata ?? null
    })
    .returning();
  const [dto] = await hydrateMessages([message], options.actor.id);
  await toConversation(options.conversation.id, {
    type: "message.created",
    conversationId: options.conversation.id,
    message: dto
  });
  return dto;
}

export async function updateMessage(options: { message: Message; editor: User; bodyText: string }) {
  if (options.message.senderId !== options.editor.id) {
    throw new HttpError(403, "Only the author can edit this message", "not_author");
  }
  if (options.message.deletedAt) throw new HttpError(400, "Deleted messages cannot be edited", "message_deleted");
  const bodyText = options.bodyText.trim();
  if (!bodyText) throw new HttpError(400, "Message cannot be empty", "empty_message");

  const [updated] = await db
    .update(messages)
    .set({ bodyText, editedAt: new Date() })
    .where(eq(messages.id, options.message.id))
    .returning();
  await db.delete(linkPreviews).where(eq(linkPreviews.messageId, updated.id));

  const [dto] = await hydrateMessages([updated], options.editor.id);
  await toConversation(updated.conversationId, {
    type: "message.updated",
    conversationId: updated.conversationId,
    message: dto
  });
  return dto;
}

export async function deleteMessage(options: { message: Message; actor: User; isModerator: boolean }) {
  if (options.message.senderId !== options.actor.id && !options.isModerator) {
    throw new HttpError(403, "Cannot delete this message", "delete_forbidden");
  }
  const [updated] = await db
    .update(messages)
    .set({ deletedAt: new Date(), deletedByUserId: options.actor.id })
    .where(eq(messages.id, options.message.id))
    .returning();
  await Promise.all([
    db.delete(messagePins).where(eq(messagePins.messageId, updated.id)),
    db.delete(savedItems).where(eq(savedItems.messageId, updated.id)),
    db.update(files).set({ deletedAt: new Date() }).where(eq(files.messageId, updated.id))
  ]);
  await toConversation(updated.conversationId, {
    type: "message.deleted",
    conversationId: updated.conversationId,
    messageId: updated.id,
    parentMessageId: updated.parentMessageId
  });
  return updated;
}
