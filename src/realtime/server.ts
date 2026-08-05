import http from "node:http";
import { Server, type Socket } from "socket.io";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";
import { and, eq, gt, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMembers, conversations, sessions, users, workspaceMembers, workspaces } from "@/db/schema";
import { tokenHash } from "@/lib/security";
import { REALTIME_CHANNEL } from "@/lib/realtime";
import { sessionCookieName } from "@/lib/auth";
import type { RealtimeEvent } from "@/shared/types";
import { broadcastPresence } from "@/server/services/presence";

const port = Number(process.env.REALTIME_PORT ?? 3001);
const redisUrl = process.env.REDIS_URL;

/** Socket counts per user so presence only flips on the last disconnect. */
const connectionsByUser = new Map<string, number>();

function cookieValue(header: string | undefined, name: string) {
  if (!header) return null;
  for (const part of header.split(";")) {
    const [rawKey, ...rawValue] = part.trim().split("=");
    if (rawKey === name) return decodeURIComponent(rawValue.join("="));
  }
  return null;
}

function roomParts(room: string) {
  const segments = room.split(":");
  if (segments.length !== 2 || !segments[0] || !segments[1]) return null;
  return { kind: segments[0], id: segments[1] };
}

async function userIdFromCookie(cookieHeader: string | undefined) {
  const token = cookieValue(cookieHeader, sessionCookieName);
  if (!token) return null;
  const [row] = await db
    .select({ userId: sessions.userId })
    .from(sessions)
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);
  return row?.userId ?? null;
}

async function canJoinRoom(userId: string, room: string) {
  const parsed = roomParts(room);
  if (!parsed) return false;

  if (parsed.kind === "user") return parsed.id === userId;

  if (parsed.kind === "workspace") {
    const [member] = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, parsed.id),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, "active"),
          isNull(workspaces.deletedAt)
        )
      )
      .limit(1);
    return !!member;
  }

  if (parsed.kind === "conversation") {
    const [member] = await db
      .select({ id: conversationMembers.id })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .innerJoin(
        workspaceMembers,
        and(
          eq(workspaceMembers.workspaceId, conversations.workspaceId),
          eq(workspaceMembers.userId, userId),
          eq(workspaceMembers.status, "active")
        )
      )
      .where(
        and(
          eq(conversationMembers.conversationId, parsed.id),
          eq(conversationMembers.userId, userId),
          isNull(conversationMembers.leftAt)
        )
      )
      .limit(1);
    return !!member;
  }

  return false;
}

const httpServer = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, connectedUsers: connectionsByUser.size, redis: !!redisUrl }));
    return;
  }

  // Direct publish endpoint for deployments without Redis. The app server posts
  // events here over the private network; a shared token guards it when set.
  if (request.url === "/publish" && request.method === "POST") {
    const token = process.env.REALTIME_TOKEN;
    if (token && request.headers["x-openchat-token"] !== token) {
      response.writeHead(403);
      response.end();
      return;
    }
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (Buffer.concat(chunks).byteLength > 1_000_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString()) as { room: string; event: RealtimeEvent };
        io.to(parsed.room).emit("event", parsed.event);
        response.writeHead(202, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
    return;
  }

  response.writeHead(404);
  response.end();
});

const io = new Server(httpServer, {
  cors: {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true
  },
  transports: ["websocket", "polling"]
});

// Redis is only needed to fan out between multiple realtime processes.
const pubClient = redisUrl ? new Redis(redisUrl) : null;
const subClient = pubClient?.duplicate() ?? null;
if (pubClient && subClient) io.adapter(createAdapter(pubClient, subClient));

io.use(async (socket, next) => {
  try {
    const userId = await userIdFromCookie(socket.handshake.headers.cookie);
    if (!userId) return next(new Error("Authentication required"));
    socket.data.userId = userId;
    return next();
  } catch (error) {
    return next(error instanceof Error ? error : new Error("Authentication failed"));
  }
});

async function markOnline(userId: string) {
  const next = (connectionsByUser.get(userId) ?? 0) + 1;
  connectionsByUser.set(userId, next);
  if (next > 1) return;
  const [updated] = await db
    .update(users)
    .set({ presence: "active", lastActiveAt: new Date() })
    .where(eq(users.id, userId))
    .returning();
  if (updated) await broadcastPresence(updated);
}

async function markOffline(userId: string) {
  const next = (connectionsByUser.get(userId) ?? 1) - 1;
  if (next > 0) {
    connectionsByUser.set(userId, next);
    return;
  }
  connectionsByUser.delete(userId);
  const [updated] = await db.update(users).set({ presence: "offline" }).where(eq(users.id, userId)).returning();
  if (updated) await broadcastPresence(updated);
}

io.on("connection", (socket: Socket) => {
  const userId = socket.data.userId as string;
  void markOnline(userId).catch((error) => console.error("presence online failed", error));

  socket.on("join", async (rooms: string[] = [], ack?: (joined: string[]) => void) => {
    const unique = Array.from(new Set(rooms)).slice(0, 500);
    const results = await Promise.all(unique.map(async (room) => ({ room, allowed: await canJoinRoom(userId, room) })));
    const joined = results.filter((entry) => entry.allowed).map((entry) => entry.room);
    for (const room of joined) socket.join(room);
    ack?.(joined);
  });

  socket.on("leave", (rooms: string[] = []) => {
    for (const room of rooms) socket.leave(room);
  });

  socket.on("typing", async (payload: { conversationId?: string; parentMessageId?: string | null }) => {
    const conversationId = payload?.conversationId;
    if (!conversationId) return;
    const room = `conversation:${conversationId}`;
    if (!socket.rooms.has(room) && !(await canJoinRoom(userId, room))) return;
    const event: RealtimeEvent = {
      type: "typing",
      conversationId,
      userId,
      parentMessageId: payload.parentMessageId ?? null
    };
    socket.to(room).emit("event", event);
  });

  socket.on("heartbeat", async () => {
    await db.update(users).set({ lastActiveAt: new Date() }).where(eq(users.id, userId));
  });

  socket.on("disconnect", () => {
    void markOffline(userId).catch((error) => console.error("presence offline failed", error));
  });
});

if (subClient) {
  subClient.subscribe(REALTIME_CHANNEL).catch((error) => {
    console.error("Failed to subscribe to realtime events", error);
  });

  subClient.on("message", (_channel, raw) => {
    try {
      const parsed = JSON.parse(raw) as { room: string; event: RealtimeEvent };
      io.to(parsed.room).emit("event", parsed.event);
    } catch (error) {
      console.error("Malformed realtime payload", error);
    }
  });
}

httpServer.listen(port, () => {
  console.log(
    `OpenChat realtime server listening on :${port} (${redisUrl ? "redis fan-out" : "direct publish, no redis"})`
  );
});
