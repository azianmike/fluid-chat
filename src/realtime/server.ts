import http from "node:http";
import { Server } from "socket.io";
import Redis from "ioredis";
import { createAdapter } from "@socket.io/redis-adapter";

const port = Number(process.env.REALTIME_PORT ?? 3001);
const redisUrl = process.env.REDIS_URL ?? "redis://localhost:6379";

const httpServer = http.createServer();
const io = new Server(httpServer, {
  cors: {
    origin: process.env.APP_URL ?? "http://localhost:3000",
    credentials: true
  }
});

const pubClient = new Redis(redisUrl);
const subClient = pubClient.duplicate();
io.adapter(createAdapter(pubClient, subClient));

io.on("connection", (socket) => {
  socket.on("join", (rooms: string[] = []) => {
    for (const room of rooms) socket.join(room);
  });

  socket.on("leave", (rooms: string[] = []) => {
    for (const room of rooms) socket.leave(room);
  });

  socket.on("typing.started", (payload) => socket.to(`conversation:${payload.conversationId}`).emit("typing.started", payload));
  socket.on("typing.stopped", (payload) => socket.to(`conversation:${payload.conversationId}`).emit("typing.stopped", payload));
});

subClient.subscribe("openchat:events").catch((error) => {
  console.error("Failed to subscribe to realtime events", error);
});

subClient.on("message", (_channel, raw) => {
  const event = JSON.parse(raw) as { event: string; room: string; payload: unknown };
  io.to(event.room).emit(event.event, event.payload);
});

httpServer.listen(port, () => {
  console.log(`OpenChat realtime server listening on :${port}`);
});
