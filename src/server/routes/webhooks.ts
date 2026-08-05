import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { channels, conversations, webhooks } from "@/db/schema";
import { HttpError, json } from "@/lib/http";
import { isModerator, requireConversationMember, requireWorkspaceMember } from "@/lib/permissions";
import { defineRoutes } from "../router";
import { createWebhook, resolveWebhook, revokeWebhook } from "../services/webhooks";
import { createMessage } from "../services/messages";
import { createAudit } from "../services/workspaces";

async function loadChannel(channelId: string) {
  const [row] = await db
    .select({ channel: channels, conversation: conversations })
    .from(channels)
    .innerJoin(conversations, eq(conversations.channelId, channels.id))
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!row) throw new HttpError(404, "Channel not found", "not_found");
  return row;
}

export const webhookRoutes = defineRoutes({
  "GET /channels/:channelId/webhooks": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    await requireConversationMember(conversation.id, user.id);
    const rows = await db
      .select({
        id: webhooks.id,
        name: webhooks.name,
        createdAt: webhooks.createdAt,
        lastUsedAt: webhooks.lastUsedAt,
        revokedAt: webhooks.revokedAt,
        createdByUserId: webhooks.createdByUserId
      })
      .from(webhooks)
      .where(eq(webhooks.conversationId, conversation.id))
      .orderBy(desc(webhooks.createdAt));
    void channel;
    return { webhooks: rows.filter((row) => !row.revokedAt) };
  },

  "POST /channels/:channelId/webhooks": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    await requireConversationMember(conversation.id, user.id);
    const member = await requireWorkspaceMember(channel.workspaceId, user.id);
    if (member.role === "guest") throw new HttpError(403, "Guests cannot create integrations", "forbidden");

    const input = await ctx.input(z.object({ name: z.string().min(1).max(60) }));
    const result = await createWebhook({
      workspaceId: channel.workspaceId,
      conversation,
      name: input.name,
      creator: user
    });
    await createAudit(channel.workspaceId, user.id, "webhook.created", "webhook", result.webhook.id, {
      channel: channel.name
    });
    // The token is only ever returned here; we store a hash.
    return json({ webhook: { id: result.webhook.id, name: result.webhook.name }, url: result.url }, 201);
  },

  "DELETE /webhooks/:webhookId": async (ctx) => {
    const user = await ctx.user();
    const webhookId = ctx.param("webhookId");
    const [webhook] = await db.select().from(webhooks).where(eq(webhooks.id, webhookId)).limit(1);
    if (!webhook) throw new HttpError(404, "Webhook not found", "not_found");
    const member = await requireWorkspaceMember(webhook.workspaceId, user.id);
    if (webhook.createdByUserId !== user.id && !isModerator(member)) {
      throw new HttpError(403, "Only the creator or an admin can remove this integration", "forbidden");
    }
    await revokeWebhook(webhookId);
    await createAudit(webhook.workspaceId, user.id, "webhook.revoked", "webhook", webhook.id);
    return { ok: true };
  },

  /** Public endpoint. The secret lives in the URL, exactly like Slack's. */
  "POST /hooks/:webhookId/:token": async (ctx) => {
    const { conversation, bot } = await resolveWebhook(ctx.param("webhookId"), ctx.param("token", { raw: true }));
    const input = await ctx.input(
      z.object({
        text: z.string().min(1).max(12000).optional(),
        blocks: z.array(z.unknown()).optional()
      })
    );
    const text = input.text ?? "";
    if (!text.trim()) throw new HttpError(400, "Provide a `text` field", "empty_message");

    const message = await createMessage({
      conversation,
      sender: bot,
      bodyText: text,
      metadata: { via: "webhook" }
    });
    return json({ ok: true, messageId: message.id }, 201);
  }
});
