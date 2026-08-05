import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import { messages, threadSubscriptions } from "@/db/schema";
import type { Message } from "@/db/schema";

export type ThreadSubscriptionState = "following" | "muted";

/**
 * Slack auto-follows a thread once you take part in it, and lets you override
 * that either way. Explicit rows win; participation is the default.
 */
export async function setThreadSubscription(options: {
  workspaceId: string;
  conversationId: string;
  rootMessageId: string;
  userId: string;
  state: ThreadSubscriptionState;
}) {
  const [row] = await db
    .insert(threadSubscriptions)
    .values({
      workspaceId: options.workspaceId,
      conversationId: options.conversationId,
      rootMessageId: options.rootMessageId,
      userId: options.userId,
      state: options.state
    })
    .onConflictDoUpdate({
      target: [threadSubscriptions.userId, threadSubscriptions.rootMessageId],
      set: { state: options.state }
    })
    .returning();
  return row;
}

export async function threadFollowersFor(rootMessageId: string) {
  const [participants, explicit] = await Promise.all([
    db
      .selectDistinct({ userId: messages.senderId })
      .from(messages)
      .where(inArray(messages.id, [rootMessageId])),
    db.select().from(threadSubscriptions).where(eq(threadSubscriptions.rootMessageId, rootMessageId))
  ]);

  const replyAuthors = await db
    .selectDistinct({ userId: messages.senderId })
    .from(messages)
    .where(eq(messages.parentMessageId, rootMessageId));

  const following = new Set<string>([
    ...participants.map((row) => row.userId),
    ...replyAuthors.map((row) => row.userId),
    ...explicit.filter((row) => row.state === "following").map((row) => row.userId)
  ]);
  for (const row of explicit) {
    if (row.state === "muted") following.delete(row.userId);
  }
  return [...following];
}

/**
 * Which of these threads the viewer is following. Authoring the root or any
 * reply follows implicitly; an explicit choice — including muting your own
 * thread — always wins.
 */
export async function followedThreadIds(rows: Array<{ id: string; senderId: string }>, userId: string) {
  if (rows.length === 0) return new Set<string>();
  const rootMessageIds = rows.map((row) => row.id);

  const [explicit, repliedTo] = await Promise.all([
    db
      .select()
      .from(threadSubscriptions)
      .where(
        and(eq(threadSubscriptions.userId, userId), inArray(threadSubscriptions.rootMessageId, rootMessageIds))
      ),
    db
      .selectDistinct({ parentMessageId: messages.parentMessageId })
      .from(messages)
      .where(and(eq(messages.senderId, userId), inArray(messages.parentMessageId, rootMessageIds)))
  ]);

  const following = new Set<string>([
    ...rows.filter((row) => row.senderId === userId).map((row) => row.id),
    ...repliedTo.map((row) => row.parentMessageId as string)
  ]);
  for (const row of explicit) {
    if (row.state === "following") following.add(row.rootMessageId);
    else following.delete(row.rootMessageId);
  }
  return following;
}

export function rootIdOf(message: Pick<Message, "id" | "parentMessageId">) {
  return message.parentMessageId ?? message.id;
}
