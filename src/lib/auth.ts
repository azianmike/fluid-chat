import { cookies } from "next/headers";
import { eq, and, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { sessions, users } from "@/db/schema";
import { addDays, newToken, tokenHash } from "./security";
import { HttpError } from "./http";

const cookieName = "openchat_session";
const SESSION_DAYS = 30;

export async function createSession(userId: string, meta?: { userAgent?: string | null; ipAddress?: string | null }) {
  const token = newToken();
  await db.insert(sessions).values({
    userId,
    tokenHash: tokenHash(token),
    userAgent: meta?.userAgent?.slice(0, 400) ?? null,
    ipAddress: meta?.ipAddress?.split(",")[0]?.trim() ?? null,
    lastSeenAt: new Date(),
    expiresAt: addDays(SESSION_DAYS)
  });
  const jar = await cookies();
  jar.set(cookieName, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * SESSION_DAYS
  });
  return token;
}

export async function clearSession() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (token) {
    await db.delete(sessions).where(eq(sessions.tokenHash, tokenHash(token)));
  }
  jar.delete(cookieName);
}

export async function currentUser() {
  const jar = await cookies();
  const token = jar.get(cookieName)?.value;
  if (!token) return null;

  const [row] = await db
    .select({ user: users, session: sessions })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, tokenHash(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  return row?.user ?? null;
}

export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new HttpError(401, "Authentication required", "unauthenticated");
  return user;
}

export { cookieName as sessionCookieName };
