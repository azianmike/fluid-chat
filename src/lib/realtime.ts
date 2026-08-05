import Redis from "ioredis";
import type { RealtimeEvent } from "@/shared/types";

const redisUrl = process.env.REDIS_URL;
let publisher: Redis | null = null;

export const REALTIME_CHANNEL = "openchat:events";

function client() {
  if (!redisUrl) return null;
  publisher ??= new Redis(redisUrl, { lazyConnect: true, maxRetriesPerRequest: 2 });
  return publisher;
}

export type RealtimeRoom = `conversation:${string}` | `workspace:${string}` | `user:${string}`;

/**
 * Fan-out is fire-and-forget: realtime is an accelerator, never a source of
 * truth, so an outage degrades the app to polling instead of failing writes.
 *
 * Redis is used when configured (required for more than one app process);
 * otherwise events are posted straight to the realtime server, so a single-node
 * self-host needs nothing but Postgres and Node.
 */
export async function publish(room: RealtimeRoom, event: RealtimeEvent) {
  const payload = JSON.stringify({ room, event });
  const redis = client();

  if (redis) {
    try {
      if (redis.status === "wait" || redis.status === "end") await redis.connect();
      await redis.publish(REALTIME_CHANNEL, payload);
      return;
    } catch (error) {
      console.warn("realtime publish over redis failed", error);
    }
  }

  const url = process.env.REALTIME_INTERNAL_URL ?? "http://localhost:3001";
  try {
    await fetch(`${url}/publish`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.REALTIME_TOKEN ? { "x-openchat-token": process.env.REALTIME_TOKEN } : {})
      },
      body: payload,
      signal: AbortSignal.timeout(1500)
    });
  } catch {
    // The realtime server is optional; clients fall back to refetching.
  }
}

export function toConversation(conversationId: string, event: RealtimeEvent) {
  return publish(`conversation:${conversationId}`, event);
}

export function toWorkspace(workspaceId: string, event: RealtimeEvent) {
  return publish(`workspace:${workspaceId}`, event);
}

export function toUser(userId: string, event: RealtimeEvent) {
  return publish(`user:${userId}`, event);
}

export function toUsers(userIds: string[], event: RealtimeEvent) {
  return Promise.all(Array.from(new Set(userIds)).map((userId) => toUser(userId, event)));
}
