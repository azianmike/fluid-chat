import Redis from "ioredis";

const redisUrl = process.env.REDIS_URL;
let publisher: Redis | null = null;

function client() {
  if (!redisUrl) return null;
  publisher ??= new Redis(redisUrl, { lazyConnect: true });
  return publisher;
}

export async function publishRealtime(event: string, room: string, payload: unknown) {
  const redis = client();
  if (!redis) return;
  if (redis.status === "wait") await redis.connect();
  await redis.publish("openchat:events", JSON.stringify({ event, room, payload }));
}
