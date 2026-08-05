import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { messagePins, messageReactions, messages, reminders, savedItems } from "@/db/schema";
import type { Message } from "@/db/schema";
import { HttpError, json } from "@/lib/http";
import {
  isModerator,
  requireConversationMember,
  requireWorkspaceMember,
  resolveConversationAccess
} from "@/lib/permissions";
import { toConversation } from "@/lib/realtime";
import { toPlainText } from "@/shared/markdown";
import { defineRoutes } from "../router";
import {
  createMessage,
  deleteMessage,
  hydrateMessageById,
  listThreadMessages,
  messageReactionSummaries,
  postSystemMessage,
  updateMessage
} from "../services/messages";
import { notify } from "../services/notifications";
import { openDirectConversation } from "../services/conversations";
import { setThreadSubscription } from "../services/threads";
import { parseWhen } from "../services/time";

async function loadMessage(messageId: string): Promise<Message> {
  const [message] = await db.select().from(messages).where(eq(messages.id, messageId)).limit(1);
  if (!message) throw new HttpError(404, "Message not found", "not_found");
  return message;
}

export const messageRoutes = defineRoutes({
  "GET /messages/:messageId": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    return { message: await hydrateMessageById(message.id, user.id) };
  },

  "PATCH /messages/:messageId": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await requireConversationMember(message.conversationId, user.id);
    const input = await ctx.input(z.object({ bodyText: z.string().min(1).max(12000) }));
    return { message: await updateMessage({ message, editor: user, bodyText: input.bodyText }) };
  },

  "DELETE /messages/:messageId": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    const member = await requireWorkspaceMember(message.workspaceId, user.id);
    await deleteMessage({ message, actor: user, isModerator: isModerator(member) });
    return { ok: true };
  },

  "GET /messages/:messageId/thread": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    const rootId = message.parentMessageId ?? message.id;
    return { messages: await listThreadMessages(rootId, user.id) };
  },

  "POST /messages/:messageId/reactions": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    const access = await resolveConversationAccess(message.conversationId, user.id);
    const input = await ctx.input(z.object({ emoji: z.string().min(1).max(64) }));
    if (message.deletedAt) throw new HttpError(400, "Message was deleted", "message_deleted");

    const [created] = await db
      .insert(messageReactions)
      .values({
        workspaceId: message.workspaceId,
        messageId: message.id,
        userId: user.id,
        emoji: input.emoji
      })
      .onConflictDoNothing()
      .returning();

    const reactions = await messageReactionSummaries(message.id, user.id);
    await toConversation(message.conversationId, {
      type: "reaction.changed",
      conversationId: message.conversationId,
      messageId: message.id,
      reactions
    });

    if (created && message.senderId !== user.id) {
      await notify({
        workspaceId: message.workspaceId,
        conversationId: message.conversationId,
        messageId: message.id,
        actorUserId: user.id,
        type: "reaction",
        body: `${input.emoji} on "${toPlainText(message.bodyText).slice(0, 80)}"`,
        userIds: [message.senderId]
      });
    }
    void access;
    return json({ reactions }, 201);
  },

  "DELETE /messages/:messageId/reactions/:emoji": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    await db
      .delete(messageReactions)
      .where(
        and(
          eq(messageReactions.messageId, message.id),
          eq(messageReactions.userId, user.id),
          eq(messageReactions.emoji, ctx.param("emoji", { raw: true }))
        )
      );
    const reactions = await messageReactionSummaries(message.id, user.id);
    await toConversation(message.conversationId, {
      type: "reaction.changed",
      conversationId: message.conversationId,
      messageId: message.id,
      reactions
    });
    return { reactions };
  },

  "POST /messages/:messageId/pin": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    const access = await requireConversationMember(message.conversationId, user.id);
    await db
      .insert(messagePins)
      .values({
        workspaceId: message.workspaceId,
        conversationId: message.conversationId,
        messageId: message.id,
        pinnedByUserId: user.id
      })
      .onConflictDoNothing();
    await postSystemMessage({
      conversation: access.conversation,
      actor: user,
      type: "pin",
      bodyText: `<@${user.id}> pinned a message to this conversation.`,
      metadata: { messageId: message.id }
    });
    await toConversation(message.conversationId, { type: "pin.changed", conversationId: message.conversationId });
    return { ok: true };
  },

  "DELETE /messages/:messageId/pin": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await requireConversationMember(message.conversationId, user.id);
    await db.delete(messagePins).where(eq(messagePins.messageId, message.id));
    await toConversation(message.conversationId, { type: "pin.changed", conversationId: message.conversationId });
    return { ok: true };
  },

  "POST /messages/:messageId/follow": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    const input = await ctx.input(z.object({ state: z.enum(["following", "muted"]) }));
    await setThreadSubscription({
      workspaceId: message.workspaceId,
      conversationId: message.conversationId,
      rootMessageId: message.parentMessageId ?? message.id,
      userId: user.id,
      state: input.state
    });
    return { ok: true, state: input.state };
  },

  "POST /messages/:messageId/save": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    await db
      .insert(savedItems)
      .values({ workspaceId: message.workspaceId, userId: user.id, messageId: message.id })
      .onConflictDoNothing();
    return { ok: true };
  },

  "DELETE /messages/:messageId/save": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await db.delete(savedItems).where(and(eq(savedItems.messageId, message.id), eq(savedItems.userId, user.id)));
    return { ok: true };
  },

  "POST /messages/:messageId/remind": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    const input = await ctx.input(
      z.object({ remindAt: z.coerce.date().optional(), inText: z.string().max(120).optional() })
    );
    const when = input.remindAt ?? parseWhen(input.inText ?? "in 30 minutes")?.at;
    if (!when) throw new HttpError(400, "Could not understand that time", "invalid_time");
    const [reminder] = await db
      .insert(reminders)
      .values({
        workspaceId: message.workspaceId,
        userId: user.id,
        conversationId: message.conversationId,
        messageId: message.id,
        text: toPlainText(message.bodyText).slice(0, 200) || "Message reminder",
        remindAt: when
      })
      .returning();
    return json({ reminder }, 201);
  },

  "POST /messages/:messageId/share": async (ctx) => {
    const user = await ctx.user();
    const message = await loadMessage(ctx.param("messageId"));
    await resolveConversationAccess(message.conversationId, user.id);
    const input = await ctx.input(
      z.object({
        conversationId: z.string().uuid().optional(),
        userIds: z.array(z.string().uuid()).max(8).optional(),
        comment: z.string().max(4000).optional()
      })
    );

    let target = input.conversationId
      ? (await requireConversationMember(input.conversationId, user.id)).conversation
      : null;
    if (!target && input.userIds?.length) {
      target = await openDirectConversation({
        workspaceId: message.workspaceId,
        actor: user,
        userIds: input.userIds
      });
    }
    if (!target) throw new HttpError(400, "Pick where to share this message", "missing_target");

    const shared = await createMessage({
      conversation: target,
      sender: user,
      bodyText: input.comment?.trim() || "",
      allowEmpty: true,
      metadata: { sharedMessageId: message.id, sharedFromConversationId: message.conversationId }
    });
    return json({ message: shared, conversationId: target.id }, 201);
  }
});
