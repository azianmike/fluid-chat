import { and, desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  emailVerificationTokens,
  passwordResetTokens,
  sessions,
  users,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import { clearSession, createSession, requireUser } from "@/lib/auth";
import { sendEmail } from "@/lib/email";
import { HttpError, json } from "@/lib/http";
import {
  addDays,
  addHours,
  hashPassword,
  newToken,
  normalizeEmail,
  slugify,
  tokenHash,
  verifyPassword
} from "@/lib/security";
import { defineRoutes } from "../router";
import { avatarColorFor, toSessionUser, toWorkspaceSummary } from "../services/serializers";
import { heartbeat } from "../services/presence";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(200),
  displayName: z.string().min(1).max(120)
});

async function uniqueHandle(base: string) {
  const root = slugify(base).replace(/-/g, ".").slice(0, 30) || "member";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const candidate = attempt === 0 ? root : `${root}${attempt + 1}`;
    const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.handle, candidate)).limit(1);
    if (!taken) return candidate;
  }
  return `${root}.${Date.now().toString(36)}`;
}

async function membershipsFor(userId: string) {
  const rows = await db
    .select({ workspace: workspaces, member: workspaceMembers })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(
      and(eq(workspaceMembers.userId, userId), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt))
    )
    .orderBy(workspaces.name);
  return rows.map((row) => ({
    workspace: toWorkspaceSummary(row.workspace),
    role: row.member.role,
    memberId: row.member.id
  }));
}

export const authRoutes = defineRoutes({
  "POST /auth/signup": async (ctx) => {
    const input = await ctx.input(signupSchema);
    const email = normalizeEmail(input.email);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new HttpError(409, "Email is already registered", "email_taken");

    const verificationToken = newToken();
    const handle = await uniqueHandle(input.displayName || email.split("@")[0]);
    const passwordHash = await hashPassword(input.password);

    const user = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email,
          displayName: input.displayName.trim(),
          handle,
          passwordHash,
          presence: "active",
          lastActiveAt: new Date(),
          preferences: { theme: "system", enterToSend: true, timeFormat: "12h", notificationSound: true }
        })
        .returning();
      await tx.update(users).set({ avatarColor: avatarColorFor(created.id) }).where(eq(users.id, created.id));
      await tx.insert(emailVerificationTokens).values({
        userId: created.id,
        tokenHash: tokenHash(verificationToken),
        expiresAt: addDays(7)
      });
      return created;
    });

    await createSession(user.id, {
      userAgent: ctx.request.headers.get("user-agent"),
      ipAddress: ctx.request.headers.get("x-forwarded-for")
    });
    await sendEmail({
      to: user.email,
      subject: "Verify your Fluid Chat email",
      text: `Verify your email: ${appUrl()}/verify-email/${verificationToken}`
    });

    return json({ user: toSessionUser({ ...user, avatarColor: avatarColorFor(user.id) }), workspaces: [] }, 201);
  },

  "POST /auth/login": async (ctx) => {
    const input = await ctx.input(z.object({ email: z.string().email(), password: z.string().min(1) }));
    const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(input.email))).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new HttpError(401, "Invalid email or password", "invalid_credentials");
    }
    await createSession(user.id, {
      userAgent: ctx.request.headers.get("user-agent"),
      ipAddress: ctx.request.headers.get("x-forwarded-for")
    });
    const refreshed = await heartbeat(user.id, "active");
    return { user: toSessionUser(refreshed ?? user), workspaces: await membershipsFor(user.id) };
  },

  "POST /auth/logout": async () => {
    await clearSession();
    return { ok: true };
  },

  "GET /auth/me": async (ctx) => {
    const user = await ctx.optionalUser();
    if (!user) return { user: null, workspaces: [] };
    return { user: toSessionUser(user), workspaces: await membershipsFor(user.id) };
  },

  "POST /auth/forgot-password": async (ctx) => {
    const input = await ctx.input(z.object({ email: z.string().email() }));
    const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(input.email))).limit(1);
    if (!user) return { ok: true };
    const token = newToken();
    await db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: addHours(2)
    });
    await sendEmail({
      to: user.email,
      subject: "Reset your Fluid Chat password",
      text: `Reset your password: ${appUrl()}/reset-password/${token}`
    });
    // The token is echoed only when email delivery is not configured, so that
    // self-hosters can still complete the flow during first-run setup.
    return process.env.SMTP_HOST ? { ok: true } : { ok: true, resetToken: token };
  },

  "POST /auth/reset-password": async (ctx) => {
    const input = await ctx.input(z.object({ token: z.string().min(1), password: z.string().min(8).max(200) }));
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash(input.token)), isNull(passwordResetTokens.usedAt)))
      .limit(1);
    if (!record || record.expiresAt < new Date()) {
      throw new HttpError(400, "Reset token is invalid or expired", "invalid_reset_token");
    }
    const passwordHash = await hashPassword(input.password);
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, record.userId));
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
      // Password changes invalidate every other session.
      await tx.delete(sessions).where(eq(sessions.userId, record.userId));
    });
    return { ok: true };
  },

  "POST /auth/change-password": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(
      z.object({ currentPassword: z.string().min(1), newPassword: z.string().min(8).max(200) })
    );
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new HttpError(400, "Current password is incorrect", "invalid_credentials");
    }
    await db
      .update(users)
      .set({ passwordHash: await hashPassword(input.newPassword), updatedAt: new Date() })
      .where(eq(users.id, user.id));
    return { ok: true };
  },

  "POST /auth/verify-email": async (ctx) => {
    const input = await ctx.input(z.object({ token: z.string().min(1) }));
    const [record] = await db
      .select()
      .from(emailVerificationTokens)
      .where(
        and(eq(emailVerificationTokens.tokenHash, tokenHash(input.token)), isNull(emailVerificationTokens.usedAt))
      )
      .limit(1);
    if (!record || record.expiresAt < new Date()) {
      throw new HttpError(400, "Verification token is invalid or expired", "invalid_verification_token");
    }
    await db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, record.userId));
      await tx
        .update(emailVerificationTokens)
        .set({ usedAt: new Date() })
        .where(eq(emailVerificationTokens.id, record.id));
    });
    return { ok: true };
  },

  "POST /auth/resend-verification": async (ctx) => {
    const user = await ctx.user();
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    const token = newToken();
    await db.insert(emailVerificationTokens).values({
      userId: user.id,
      tokenHash: tokenHash(token),
      expiresAt: addDays(7)
    });
    await sendEmail({
      to: user.email,
      subject: "Verify your Fluid Chat email",
      text: `Verify your email: ${appUrl()}/verify-email/${token}`
    });
    return { ok: true };
  },

  "GET /auth/sessions": async (ctx) => {
    const user = await ctx.user();
    const rows = await db
      .select({
        id: sessions.id,
        userAgent: sessions.userAgent,
        ipAddress: sessions.ipAddress,
        createdAt: sessions.createdAt,
        lastSeenAt: sessions.lastSeenAt,
        expiresAt: sessions.expiresAt
      })
      .from(sessions)
      .where(eq(sessions.userId, user.id))
      .orderBy(desc(sessions.createdAt));
    return { sessions: rows };
  },

  "DELETE /auth/sessions/:sessionId": async (ctx) => {
    const user = await ctx.user();
    await db.delete(sessions).where(and(eq(sessions.id, ctx.param("sessionId")), eq(sessions.userId, user.id)));
    return { ok: true };
  },

  "DELETE /auth/account": async (ctx) => {
    const user = await requireUser();
    const input = await ctx.input(z.object({ password: z.string().min(1) }));
    if (!user.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new HttpError(400, "Password is incorrect", "invalid_credentials");
    }
    const owned = await db
      .select({ id: workspaceMembers.id })
      .from(workspaceMembers)
      .where(
        and(
          eq(workspaceMembers.userId, user.id),
          eq(workspaceMembers.role, "owner"),
          eq(workspaceMembers.status, "active")
        )
      );
    if (owned.length > 0) {
      throw new HttpError(400, "Transfer or delete your workspaces before closing your account", "owns_workspaces");
    }
    await db.delete(users).where(eq(users.id, user.id));
    await clearSession();
    return { ok: true };
  }
});
