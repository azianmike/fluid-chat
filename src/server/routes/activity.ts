import { and, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  channels,
  conversationMembers,
  conversations,
  drafts,
  files,
  messages,
  notifications,
  reminders,
  savedItems,
  scheduledMessages
} from "@/db/schema";
import { HttpError } from "@/lib/http";
import { requireWorkspaceMember } from "@/lib/permissions";
import { defineRoutes } from "../router";
import { hydrateMessages } from "../services/messages";
import { markNotificationsRead, unreadNotificationCount } from "../services/notifications";
import { searchMessages } from "../services/search";
import { SLASH_COMMANDS } from "../services/slash";
import { toFileSummary, toNotificationDto } from "../services/serializers";
import { parseWhen } from "../services/time";

export const activityRoutes = defineRoutes({
  "GET /workspaces/:workspaceId/search": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const query = ctx.query("q")?.trim();
    if (!query) return { results: [], parsed: null };
    return searchMessages({
      workspaceId,
      viewerId: user.id,
      query,
      limit: ctx.queryInt("limit", 40),
      sort: ctx.query("sort") === "relevant" ? "relevant" : "recent"
    });
  },

  "GET /workspaces/:workspaceId/notifications": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.workspaceId, workspaceId),
          eq(notifications.userId, user.id),
          ctx.queryFlag("unreadOnly") ? isNull(notifications.readAt) : undefined
        )
      )
      .orderBy(desc(notifications.createdAt))
      .limit(ctx.queryInt("limit", 50));
    return {
      notifications: rows.map(toNotificationDto),
      unreadCount: await unreadNotificationCount(workspaceId, user.id)
    };
  },

  "POST /workspaces/:workspaceId/notifications/read": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const input = await ctx.input(z.object({ notificationIds: z.array(z.string().uuid()).optional() }));
    await markNotificationsRead({ workspaceId, userId: user.id, notificationIds: input.notificationIds });
    return { ok: true };
  },

  /** Thread inbox: every thread the user started or replied to, newest first. */
  "GET /workspaces/:workspaceId/threads": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);

    const participation = await db
      .selectDistinct({ parentMessageId: messages.parentMessageId })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.senderId, user.id),
          sql`${messages.parentMessageId} is not null`
        )
      );
    const started = await db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.workspaceId, workspaceId),
          eq(messages.senderId, user.id),
          isNull(messages.parentMessageId),
          sql`exists (select 1 from messages replies where replies.parent_message_id = ${messages.id})`
        )
      );

    const rootIds = Array.from(
      new Set([
        ...participation.map((row) => row.parentMessageId).filter(Boolean as unknown as (value: string | null) => value is string),
        ...started.map((row) => row.id)
      ])
    );
    if (rootIds.length === 0) return { threads: [] };

    const roots = await db
      .select()
      .from(messages)
      .where(and(inArray(messages.id, rootIds), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(50);
    const hydratedRoots = await hydrateMessages(roots, user.id);

    const latestReplies = await db
      .select()
      .from(messages)
      .where(and(inArray(messages.parentMessageId, roots.map((row) => row.id)), isNull(messages.deletedAt)))
      .orderBy(desc(messages.createdAt))
      .limit(200);
    const hydratedReplies = await hydrateMessages(latestReplies, user.id);
    const repliesByRoot = new Map<string, typeof hydratedReplies>();
    for (const reply of hydratedReplies) {
      if (!reply.parentMessageId) continue;
      repliesByRoot.set(reply.parentMessageId, [...(repliesByRoot.get(reply.parentMessageId) ?? []), reply]);
    }

    return {
      threads: hydratedRoots
        .map((root) => ({
          root,
          replies: (repliesByRoot.get(root.id) ?? []).slice(0, 3).reverse()
        }))
        .sort((a, b) => {
          const aTime = new Date(a.root.thread.lastReplyAt ?? a.root.createdAt).getTime();
          const bTime = new Date(b.root.thread.lastReplyAt ?? b.root.createdAt).getTime();
          return bTime - aTime;
        })
    };
  },

  "GET /workspaces/:workspaceId/saved": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select({ message: messages, savedAt: savedItems.createdAt, completedAt: savedItems.completedAt })
      .from(savedItems)
      .innerJoin(messages, eq(messages.id, savedItems.messageId))
      .where(and(eq(savedItems.workspaceId, workspaceId), eq(savedItems.userId, user.id)))
      .orderBy(desc(savedItems.createdAt))
      .limit(100);
    const hydrated = await hydrateMessages(rows.map((row) => row.message), user.id);
    return {
      saved: hydrated.map((message, index) => ({
        message,
        savedAt: new Date(rows[index].savedAt).toISOString(),
        completedAt: rows[index].completedAt
      }))
    };
  },

  "GET /workspaces/:workspaceId/drafts": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.workspaceId, workspaceId), eq(drafts.userId, user.id)))
      .orderBy(desc(drafts.updatedAt));
    return { drafts: rows };
  },

  /** All Unreads: every conversation with unread messages, plus the messages. */
  "GET /workspaces/:workspaceId/unreads": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);

    const memberships = await db
      .select({ conversationId: conversationMembers.conversationId, lastReadAt: conversationMembers.lastReadAt })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .leftJoin(channels, eq(channels.id, conversations.channelId))
      .where(
        and(
          eq(conversationMembers.workspaceId, workspaceId),
          eq(conversationMembers.userId, user.id),
          isNull(conversationMembers.leftAt),
          isNull(conversationMembers.mutedAt),
          or(isNull(conversations.channelId), isNull(channels.archivedAt))
        )
      );
    if (memberships.length === 0) return { unreads: [] };

    const unread = await db
      .select()
      .from(messages)
      .where(
        and(
          inArray(messages.conversationId, memberships.map((row) => row.conversationId)),
          isNull(messages.deletedAt),
          ne(messages.senderId, user.id),
          or(isNull(messages.parentMessageId), eq(messages.threadBroadcast, true)),
          or(
            ...memberships.map((row) =>
              row.lastReadAt
                ? and(eq(messages.conversationId, row.conversationId), gt(messages.createdAt, row.lastReadAt))
                : eq(messages.conversationId, row.conversationId)
            )
          )
        )
      )
      .orderBy(messages.createdAt)
      .limit(300);

    const hydrated = await hydrateMessages(unread, user.id);
    const grouped = new Map<string, typeof hydrated>();
    for (const message of hydrated) {
      grouped.set(message.conversationId, [...(grouped.get(message.conversationId) ?? []), message]);
    }
    return {
      unreads: [...grouped.entries()].map(([conversationId, list]) => ({ conversationId, messages: list }))
    };
  },

  "GET /workspaces/:workspaceId/files": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select({ file: files })
      .from(files)
      .innerJoin(
        conversationMembers,
        and(
          eq(conversationMembers.conversationId, files.conversationId),
          eq(conversationMembers.userId, user.id),
          isNull(conversationMembers.leftAt)
        )
      )
      .where(and(eq(files.workspaceId, workspaceId), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt))
      .limit(ctx.queryInt("limit", 60));
    return { files: rows.map((row) => toFileSummary(row.file)) };
  },

  /* -------------------------------------------------------------- scheduled */

  "GET /workspaces/:workspaceId/scheduled": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select()
      .from(scheduledMessages)
      .where(
        and(
          eq(scheduledMessages.workspaceId, workspaceId),
          eq(scheduledMessages.senderId, user.id),
          eq(scheduledMessages.status, "pending")
        )
      )
      .orderBy(scheduledMessages.sendAt);
    return { scheduled: rows };
  },

  "DELETE /scheduled/:scheduledId": async (ctx) => {
    const user = await ctx.user();
    const scheduledId = ctx.param("scheduledId");
    const [row] = await db.select().from(scheduledMessages).where(eq(scheduledMessages.id, scheduledId)).limit(1);
    if (!row || row.senderId !== user.id) throw new HttpError(404, "Scheduled message not found", "not_found");
    await db
      .update(scheduledMessages)
      .set({ status: "canceled", updatedAt: new Date() })
      .where(eq(scheduledMessages.id, row.id));
    return { ok: true };
  },

  /* -------------------------------------------------------------- reminders */

  "GET /workspaces/:workspaceId/reminders": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db
      .select()
      .from(reminders)
      .where(and(eq(reminders.workspaceId, workspaceId), eq(reminders.userId, user.id), isNull(reminders.completedAt)))
      .orderBy(reminders.remindAt);
    return { reminders: rows };
  },

  "POST /workspaces/:workspaceId/reminders": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const input = await ctx.input(
      z.object({
        text: z.string().min(1).max(500),
        remindAt: z.coerce.date().optional(),
        inText: z.string().max(120).optional(),
        conversationId: z.string().uuid().optional()
      })
    );
    const when = input.remindAt ?? parseWhen(input.inText ?? "")?.at;
    if (!when) throw new HttpError(400, "Could not understand that time", "invalid_time");
    const [reminder] = await db
      .insert(reminders)
      .values({
        workspaceId,
        userId: user.id,
        conversationId: input.conversationId ?? null,
        text: input.text,
        remindAt: when
      })
      .returning();
    return { reminder };
  },

  "POST /reminders/:reminderId/complete": async (ctx) => {
    const user = await ctx.user();
    const reminderId = ctx.param("reminderId");
    const [reminder] = await db
      .update(reminders)
      .set({ completedAt: new Date() })
      .where(and(eq(reminders.id, reminderId), eq(reminders.userId, user.id)))
      .returning();
    if (!reminder) throw new HttpError(404, "Reminder not found", "not_found");
    return { reminder };
  },

  "GET /commands": async () => ({ commands: SLASH_COMMANDS })
});
