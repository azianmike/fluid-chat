import { and, count, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMembers, messages, notifications } from "@/db/schema";

export type ConversationActivity = { unreadCount: number; mentionCount: number };

const empty: ConversationActivity = { unreadCount: 0, mentionCount: 0 };

/**
 * Unread state is derived from `conversation_members.last_read_at` rather than
 * per-message read rows, so a busy workspace stays cheap to query.
 */
export async function conversationActivity(conversationIds: string[], userId: string) {
  const activity = new Map<string, ConversationActivity>();
  for (const id of conversationIds) activity.set(id, { ...empty });
  if (conversationIds.length === 0) return activity;

  const [unreadRows, mentionRows] = await Promise.all([
    db
      .select({ conversationId: messages.conversationId, unreadCount: count() })
      .from(messages)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, messages.conversationId),
          eq(conversationMembers.userId, userId),
          isNull(conversationMembers.leftAt)
        )
      )
      .where(
        and(
          inArray(messages.conversationId, conversationIds),
          isNull(messages.deletedAt),
          ne(messages.senderId, userId),
          or(isNull(messages.parentMessageId), eq(messages.threadBroadcast, true)),
          or(isNull(conversationMembers.lastReadAt), sql`${messages.createdAt} > ${conversationMembers.lastReadAt}`)
        )
      )
      .groupBy(messages.conversationId),
    db
      .select({ conversationId: notifications.conversationId, mentionCount: count() })
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          inArray(notifications.type, ["mention", "dm", "thread_reply", "keyword"]),
          isNull(notifications.readAt),
          inArray(notifications.conversationId, conversationIds)
        )
      )
      .groupBy(notifications.conversationId)
  ]);

  for (const row of unreadRows) {
    activity.set(row.conversationId, { ...(activity.get(row.conversationId) ?? empty), unreadCount: row.unreadCount });
  }
  for (const row of mentionRows) {
    if (!row.conversationId) continue;
    activity.set(row.conversationId, { ...(activity.get(row.conversationId) ?? empty), mentionCount: row.mentionCount });
  }

  return activity;
}

export async function markConversationRead(options: {
  conversationId: string;
  userId: string;
  messageId?: string | null;
  readAt?: Date;
}) {
  const readAt = options.readAt ?? new Date();
  await db
    .update(conversationMembers)
    .set({ lastReadAt: readAt, lastReadMessageId: options.messageId ?? undefined })
    .where(
      and(
        eq(conversationMembers.conversationId, options.conversationId),
        eq(conversationMembers.userId, options.userId)
      )
    );
  return readAt;
}
