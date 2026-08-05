import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMembers, conversations, users, webhooks } from "@/db/schema";
import type { Conversation, User } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { newToken, tokenHash } from "@/lib/security";
import { avatarColorFor } from "./serializers";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

export function webhookUrl(id: string, token: string) {
  return `${appUrl()}/api/hooks/${id}/${token}`;
}

/**
 * Incoming webhooks are the cheapest useful integration point: a URL that posts
 * into one conversation as its own bot identity, so CI, alerting or a cron job
 * can talk to a channel without a user account.
 */
export async function createWebhook(options: {
  workspaceId: string;
  conversation: Conversation;
  name: string;
  creator: User;
}) {
  const token = newToken();
  const handle = `${options.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24) || "integration"}-${randomUUID().slice(0, 6)}`;

  const created = await db.transaction(async (tx) => {
    const [bot] = await tx
      .insert(users)
      .values({
        email: `${handle}@bots.fluidchat.invalid`,
        displayName: options.name,
        handle,
        isBot: true,
        presence: "active",
        timezone: "UTC"
      })
      .returning();
    await tx.update(users).set({ avatarColor: avatarColorFor(bot.id) }).where(eq(users.id, bot.id));

    await tx
      .insert(conversationMembers)
      .values({
        workspaceId: options.workspaceId,
        conversationId: options.conversation.id,
        userId: bot.id,
        role: "bot",
        lastReadAt: new Date()
      })
      .onConflictDoNothing();

    const [webhook] = await tx
      .insert(webhooks)
      .values({
        workspaceId: options.workspaceId,
        conversationId: options.conversation.id,
        name: options.name,
        tokenHash: tokenHash(token),
        botUserId: bot.id,
        createdByUserId: options.creator.id
      })
      .returning();
    return webhook;
  });

  return { webhook: created, token, url: webhookUrl(created.id, token) };
}

export async function resolveWebhook(webhookId: string, token: string) {
  const [webhook] = await db
    .select()
    .from(webhooks)
    .where(and(eq(webhooks.id, webhookId), isNull(webhooks.revokedAt)))
    .limit(1);
  if (!webhook || webhook.tokenHash !== tokenHash(token)) {
    throw new HttpError(404, "Unknown webhook", "invalid_webhook");
  }

  const [conversation] = await db
    .select()
    .from(conversations)
    .where(eq(conversations.id, webhook.conversationId))
    .limit(1);
  const [bot] = await db.select().from(users).where(eq(users.id, webhook.botUserId)).limit(1);
  if (!conversation || !bot) throw new HttpError(404, "Unknown webhook", "invalid_webhook");

  await db.update(webhooks).set({ lastUsedAt: new Date() }).where(eq(webhooks.id, webhook.id));
  return { webhook, conversation, bot };
}

export async function revokeWebhook(webhookId: string) {
  const [webhook] = await db
    .update(webhooks)
    .set({ revokedAt: new Date() })
    .where(eq(webhooks.id, webhookId))
    .returning();
  if (!webhook) throw new HttpError(404, "Webhook not found", "not_found");
  await db
    .update(conversationMembers)
    .set({ leftAt: new Date() })
    .where(
      and(
        eq(conversationMembers.conversationId, webhook.conversationId),
        eq(conversationMembers.userId, webhook.botUserId)
      )
    );
  return webhook;
}
