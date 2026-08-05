import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  conversationMembers,
  drafts,
  files,
  messagePins,
  messages,
  scheduledMessages
} from "@/db/schema";
import { HttpError, json } from "@/lib/http";
import {
  ensureConversationMembership,
  requireConversationMember,
  requireWorkspaceMember,
  resolveConversationAccess
} from "@/lib/permissions";
import { toConversation, toUsers } from "@/lib/realtime";
import { defineRoutes } from "../router";
import {
  conversationLabel,
  conversationMemberList,
  listSidebarConversations,
  openDirectConversation
} from "../services/conversations";
import {
  assertCanPost,
  createMessage,
  hydrateMessages,
  listConversationMessages
} from "../services/messages";
import { markConversationRead } from "../services/unread";
import { markNotificationsRead } from "../services/notifications";
import { isSlashCommand, runSlashCommand } from "../services/slash";
import { toConversationSummary, toFileSummary, toPublicUser } from "../services/serializers";

const sendSchema = z.object({
  bodyText: z.string().max(12000).default(""),
  clientMessageId: z.string().min(1).max(120).optional(),
  parentMessageId: z.string().uuid().optional(),
  threadBroadcast: z.boolean().optional(),
  fileIds: z.array(z.string().uuid()).max(10).optional()
});

export const conversationRoutes = defineRoutes({
  "GET /workspaces/:workspaceId/conversations": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    return { conversations: await listSidebarConversations(workspaceId, user.id) };
  },

  "POST /conversations/dm": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(
      z.object({
        workspaceId: z.string().uuid(),
        userIds: z.array(z.string().uuid()).min(1).max(8)
      })
    );
    await requireWorkspaceMember(input.workspaceId, user.id);
    const conversation = await openDirectConversation({
      workspaceId: input.workspaceId,
      actor: user,
      userIds: input.userIds
    });
    const members = await conversationMemberList(conversation.id);
    return json(
      {
        conversation: toConversationSummary({
          conversation,
          memberIds: members.map((row) => row.member.userId),
          membership: members.find((row) => row.member.userId === user.id)?.member ?? null
        })
      },
      201
    );
  },

  "GET /conversations/:conversationId": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    const access = await resolveConversationAccess(conversationId, user.id);
    const members = await conversationMemberList(conversationId);
    return {
      conversation: toConversationSummary({
        conversation: access.conversation,
        channel: access.channel,
        membership: access.membership,
        memberIds: members.map((row) => row.member.userId),
        memberCount: members.length
      }),
      members: members.map((row) => toPublicUser(row.user)),
      label: await conversationLabel(access.conversation, user.id)
    };
  },

  "GET /conversations/:conversationId/messages": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    await resolveConversationAccess(conversationId, user.id);
    return listConversationMessages({
      conversationId,
      viewerId: user.id,
      before: ctx.query("before"),
      after: ctx.query("after"),
      limit: ctx.queryInt("limit", 50)
    });
  },

  "POST /conversations/:conversationId/messages": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    const access = await resolveConversationAccess(conversationId, user.id);
    const input = await ctx.input(sendSchema);
    const bodyText = input.bodyText.trim();

    await assertCanPost(access.conversation, user.id);
    await ensureConversationMembership(access, user.id);

    if (isSlashCommand(bodyText)) {
      const outcome = await runSlashCommand(bodyText, {
        conversation: access.conversation,
        channel: access.channel,
        actor: user,
        member: access.member,
        clientMessageId: input.clientMessageId
      });
      return json({ command: outcome }, 200);
    }

    const message = await createMessage({
      conversation: access.conversation,
      sender: user,
      bodyText,
      clientMessageId: input.clientMessageId,
      parentMessageId: input.parentMessageId,
      threadBroadcast: input.threadBroadcast,
      fileIds: input.fileIds
    });
    await markConversationRead({ conversationId, userId: user.id, messageId: message.id });
    return json({ message }, 201);
  },

  "POST /conversations/:conversationId/read": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    const access = await requireConversationMember(conversationId, user.id);
    const input = await ctx.input(z.object({ messageId: z.string().uuid().optional() }));
    const readAt = await markConversationRead({ conversationId, userId: user.id, messageId: input.messageId });
    await markNotificationsRead({
      workspaceId: access.conversation.workspaceId,
      userId: user.id,
      conversationId
    });
    await toConversation(conversationId, {
      type: "conversation.read",
      conversationId,
      userId: user.id,
      lastReadAt: readAt.toISOString()
    });
    return { ok: true, lastReadAt: readAt.toISOString() };
  },

  "POST /conversations/:conversationId/unread": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    await requireConversationMember(conversationId, user.id);
    const input = await ctx.input(z.object({ beforeMessageId: z.string().uuid().optional() }));

    let readAt: Date | null = null;
    if (input.beforeMessageId) {
      const [message] = await db
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(eq(messages.id, input.beforeMessageId))
        .limit(1);
      if (message) readAt = new Date(new Date(message.createdAt).getTime() - 1);
    }
    await db
      .update(conversationMembers)
      .set({ lastReadAt: readAt, lastReadMessageId: null })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)));
    return { ok: true };
  },

  "PATCH /conversations/:conversationId/membership": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    await requireConversationMember(conversationId, user.id);
    const input = await ctx.input(
      z.object({
        starred: z.boolean().optional(),
        muted: z.boolean().optional(),
        notificationLevel: z.enum(["all", "mentions", "none"]).optional(),
        sectionId: z.string().uuid().nullable().optional(),
        hidden: z.boolean().optional()
      })
    );
    const [membership] = await db
      .update(conversationMembers)
      .set({
        starred: input.starred,
        mutedAt: input.muted === undefined ? undefined : input.muted ? new Date() : null,
        notificationLevel: input.notificationLevel,
        sectionId: input.sectionId,
        hiddenAt: input.hidden === undefined ? undefined : input.hidden ? new Date() : null
      })
      .where(and(eq(conversationMembers.conversationId, conversationId), eq(conversationMembers.userId, user.id)))
      .returning();
    await toUsers([user.id], { type: "conversation.updated", conversationId });
    return { membership };
  },

  "GET /conversations/:conversationId/pins": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    await resolveConversationAccess(conversationId, user.id);
    const rows = await db
      .select({ message: messages, pinnedBy: messagePins.pinnedByUserId, pinnedAt: messagePins.createdAt })
      .from(messagePins)
      .innerJoin(messages, eq(messages.id, messagePins.messageId))
      .where(eq(messagePins.conversationId, conversationId))
      .orderBy(desc(messagePins.createdAt));
    const hydrated = await hydrateMessages(rows.map((row) => row.message), user.id);
    return {
      pins: hydrated.map((message, index) => ({
        message,
        pinnedByUserId: rows[index].pinnedBy,
        pinnedAt: new Date(rows[index].pinnedAt).toISOString()
      }))
    };
  },

  "GET /conversations/:conversationId/files": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    await resolveConversationAccess(conversationId, user.id);
    const rows = await db
      .select()
      .from(files)
      .where(and(eq(files.conversationId, conversationId), isNull(files.deletedAt)))
      .orderBy(desc(files.createdAt))
      .limit(ctx.queryInt("limit", 50));
    return { files: rows.map(toFileSummary) };
  },

  "PUT /conversations/:conversationId/draft": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    const access = await resolveConversationAccess(conversationId, user.id);
    const input = await ctx.input(
      z.object({ bodyText: z.string().max(12000), parentMessageId: z.string().uuid().nullable().optional() })
    );
    const threadKey = input.parentMessageId ?? "root";

    if (!input.bodyText.trim()) {
      await db
        .delete(drafts)
        .where(
          and(
            eq(drafts.userId, user.id),
            eq(drafts.conversationId, conversationId),
            eq(drafts.threadKey, threadKey)
          )
        );
      return { draft: null };
    }

    const [draft] = await db
      .insert(drafts)
      .values({
        workspaceId: access.conversation.workspaceId,
        userId: user.id,
        conversationId,
        parentMessageId: input.parentMessageId ?? null,
        threadKey,
        bodyText: input.bodyText
      })
      .onConflictDoUpdate({
        target: [drafts.userId, drafts.conversationId, drafts.threadKey],
        set: { bodyText: input.bodyText, updatedAt: new Date() }
      })
      .returning();
    return { draft };
  },

  "POST /conversations/:conversationId/scheduled": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    const access = await requireConversationMember(conversationId, user.id);
    await assertCanPost(access.conversation, user.id);
    const input = await ctx.input(
      z.object({
        bodyText: z.string().min(1).max(12000),
        sendAt: z.coerce.date(),
        parentMessageId: z.string().uuid().nullable().optional(),
        fileIds: z.array(z.string().uuid()).max(10).optional()
      })
    );
    if (input.sendAt.getTime() < Date.now() + 30_000) {
      throw new HttpError(400, "Pick a time at least a minute from now", "invalid_schedule");
    }
    const [scheduled] = await db
      .insert(scheduledMessages)
      .values({
        workspaceId: access.conversation.workspaceId,
        conversationId,
        senderId: user.id,
        parentMessageId: input.parentMessageId ?? null,
        bodyText: input.bodyText,
        fileIds: input.fileIds ?? null,
        sendAt: input.sendAt
      })
      .returning();
    return json({ scheduled }, 201);
  },

  "POST /conversations/:conversationId/typing": async (ctx) => {
    const user = await ctx.user();
    const conversationId = ctx.param("conversationId");
    await requireConversationMember(conversationId, user.id);
    const input = await ctx.input(z.object({ parentMessageId: z.string().uuid().nullable().optional() }));
    await toConversation(conversationId, {
      type: "typing",
      conversationId,
      userId: user.id,
      parentMessageId: input.parentMessageId ?? null
    });
    return { ok: true };
  }
});
