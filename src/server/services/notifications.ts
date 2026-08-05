import { and, count, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMembers, notifications, users } from "@/db/schema";
import type { NewNotification } from "@/db/schema";
import { toUser } from "@/lib/realtime";
import { toNotificationDto } from "./serializers";

export type NotificationKind =
  | "mention"
  | "dm"
  | "thread_reply"
  | "reaction"
  | "channel_invite"
  | "invite_accepted"
  | "reminder"
  | "scheduled_sent"
  | "keyword";

type NotifyInput = {
  workspaceId: string;
  conversationId?: string | null;
  messageId?: string | null;
  actorUserId?: string | null;
  type: NotificationKind;
  body?: string | null;
  userIds: string[];
};

/**
 * Writes activity-feed rows and pushes them to each recipient. Conversation
 * mute/notification-level filtering happens in `deliverableRecipients` so every
 * caller gets the same rules.
 */
export async function notify(input: NotifyInput) {
  const userIds = Array.from(new Set(input.userIds.filter(Boolean)));
  if (userIds.length === 0) return [];

  const values: NewNotification[] = userIds.map((userId) => ({
    workspaceId: input.workspaceId,
    userId,
    type: input.type,
    actorUserId: input.actorUserId ?? null,
    conversationId: input.conversationId ?? null,
    messageId: input.messageId ?? null,
    body: input.body ?? null
  }));

  const rows = await db.insert(notifications).values(values).returning();
  await Promise.all(
    rows.map((row) => toUser(row.userId, { type: "notification.created", notification: toNotificationDto(row) }))
  );
  return rows;
}

/**
 * Filters conversation members down to the people who should hear about an
 * event, honoring mutes and per-conversation notification levels.
 */
export async function deliverableRecipients(options: {
  conversationId: string;
  excludeUserId?: string;
  mentioned?: boolean;
}) {
  const rows = await db
    .select({
      userId: conversationMembers.userId,
      mutedAt: conversationMembers.mutedAt,
      level: conversationMembers.notificationLevel
    })
    .from(conversationMembers)
    .where(and(eq(conversationMembers.conversationId, options.conversationId), isNull(conversationMembers.leftAt)));

  return rows
    .filter((row) => row.userId !== options.excludeUserId)
    .filter((row) => {
      if (row.level === "none") return false;
      if (row.mutedAt) return options.mentioned === true;
      if (row.level === "mentions") return options.mentioned === true;
      return true;
    })
    .map((row) => row.userId);
}

export async function unreadNotificationCount(workspaceId: string, userId: string) {
  const [row] = await db
    .select({ value: count() })
    .from(notifications)
    .where(
      and(
        eq(notifications.workspaceId, workspaceId),
        eq(notifications.userId, userId),
        isNull(notifications.readAt)
      )
    );
  return row?.value ?? 0;
}

export async function markNotificationsRead(options: {
  workspaceId: string;
  userId: string;
  notificationIds?: string[];
  conversationId?: string;
}) {
  await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(
      and(
        eq(notifications.workspaceId, options.workspaceId),
        eq(notifications.userId, options.userId),
        isNull(notifications.readAt),
        options.notificationIds?.length ? inArray(notifications.id, options.notificationIds) : undefined,
        options.conversationId ? eq(notifications.conversationId, options.conversationId) : undefined
      )
    );
}

/** Keyword highlights ("notify me when someone says X") from user preferences. */
export async function keywordRecipients(workspaceId: string, conversationId: string, bodyText: string, senderId: string) {
  const rows = await db
    .select({ id: users.id, preferences: users.preferences })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt)));

  const lowered = bodyText.toLowerCase();
  void workspaceId;
  return rows
    .filter((row) => row.id !== senderId)
    .filter((row) => {
      const keywords = (row.preferences as { keywords?: string[] } | null)?.keywords ?? [];
      return keywords.some((keyword) => keyword.trim().length > 1 && lowered.includes(keyword.trim().toLowerCase()));
    })
    .map((row) => row.id);
}
