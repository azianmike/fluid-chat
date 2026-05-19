import { NextRequest } from "next/server";
import { and, count, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditEvents,
  channels,
  conversationMembers,
  conversations,
  emailVerificationTokens,
  exportJobs,
  messageReactions,
  messages,
  notifications,
  passwordResetTokens,
  users,
  workspaceInvites,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import { clearSession, createSession, currentUser, requireUser } from "@/lib/auth";
import { enforceSeatLimit, requireWorkspaceWritable, workspaceUsage } from "@/lib/billing";
import { sendEmail } from "@/lib/email";
import { enforceCsrf, enforceRateLimit } from "@/lib/guards";
import { body, errorResponse, HttpError, json } from "@/lib/http";
import {
  addDays,
  addHours,
  hashPassword,
  newToken,
  normalizeChannelName,
  normalizeEmail,
  slugify,
  tokenHash,
  verifyPassword
} from "@/lib/security";
import {
  requireConversationMember,
  requireWorkspaceAdmin,
  requireWorkspaceMember,
  requireWorkspaceOwner
} from "@/lib/permissions";
import { publishRealtime } from "@/lib/realtime";

type Params = { params: Promise<{ path?: string[] }> };
type WorkspaceInviteRecord = typeof workspaceInvites.$inferSelect;
type NewNotification = typeof notifications.$inferInsert;
type NotificationRecord = typeof notifications.$inferSelect;

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1).max(120)
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1)
});

const workspaceSchema = z.object({
  name: z.string().min(2).max(120),
  slug: z.string().min(2).max(64).optional()
});

const inviteSchema = z.object({
  emails: z.array(z.string().email()).min(1),
  role: z.enum(["admin", "member"]).default("member")
});

const channelSchema = z.object({
  name: z.string().min(1).max(80),
  visibility: z.enum(["public", "private"]).default("public"),
  description: z.string().max(500).optional(),
  topic: z.string().max(250).optional(),
  memberIds: z.array(z.string().uuid()).max(100).optional()
});

const messageSchema = z.object({
  bodyText: z.string().min(1).max(12000),
  clientMessageId: z.string().min(1).max(120).optional(),
  parentMessageId: z.string().uuid().optional()
});

const reactionSchema = z.object({
  emoji: z.string().min(1).max(32)
});

type ConversationActivity = {
  unreadCount: number;
  mentionCount: number;
};

function pathOf(params: { path?: string[] }) {
  return `/${(params.path ?? []).join("/")}`;
}

function isUuid(value: string | undefined) {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function createAudit(workspaceId: string, actorUserId: string | null, type: string, entityType?: string, entityId?: string, metadata?: unknown) {
  await db.insert(auditEvents).values({ workspaceId, actorUserId, type, entityType, entityId, metadata });
}

function publicInvite(invite: WorkspaceInviteRecord) {
  const { tokenHash, ...safeInvite } = invite;
  void tokenHash;
  return safeInvite;
}

function inviteUrl(token: string) {
  return `${process.env.APP_URL ?? "http://localhost:3000"}/invite/${token}`;
}

async function publishNotifications(rows: NotificationRecord[]) {
  await Promise.all(rows.map((notification) => publishRealtime("notification.created", `user:${notification.userId}`, notification)));
}

async function createNotifications(values: NewNotification[]) {
  if (values.length === 0) return [];
  const rows = await db.insert(notifications).values(values).returning();
  await publishNotifications(rows);
  return rows;
}

async function conversationActivityForUser(conversationIds: string[], userId: string) {
  const activity = new Map<string, ConversationActivity>();
  for (const conversationId of conversationIds) {
    activity.set(conversationId, { unreadCount: 0, mentionCount: 0 });
  }
  if (conversationIds.length === 0) return activity;

  const unreadRows = await db
    .select({ conversationId: messages.conversationId, unreadCount: count() })
    .from(messages)
    .innerJoin(conversationMembers, and(
      eq(conversationMembers.conversationId, messages.conversationId),
      eq(conversationMembers.userId, userId),
      isNull(conversationMembers.leftAt)
    ))
    .where(and(
      inArray(messages.conversationId, conversationIds),
      isNull(messages.deletedAt),
      ne(messages.senderId, userId),
      or(isNull(conversationMembers.lastReadAt), sql`${messages.createdAt} > ${conversationMembers.lastReadAt}`)
    ))
    .groupBy(messages.conversationId);

  const mentionRows = await db
    .select({ conversationId: notifications.conversationId, mentionCount: count() })
    .from(notifications)
    .where(and(
      eq(notifications.userId, userId),
      eq(notifications.type, "mention"),
      isNull(notifications.readAt),
      inArray(notifications.conversationId, conversationIds)
    ))
    .groupBy(notifications.conversationId);

  for (const row of unreadRows) {
    activity.set(row.conversationId, { ...(activity.get(row.conversationId) ?? { unreadCount: 0, mentionCount: 0 }), unreadCount: row.unreadCount });
  }
  for (const row of mentionRows) {
    if (!row.conversationId) continue;
    activity.set(row.conversationId, { ...(activity.get(row.conversationId) ?? { unreadCount: 0, mentionCount: 0 }), mentionCount: row.mentionCount });
  }

  return activity;
}

async function createDefaultWorkspace(name: string, slugInput: string | undefined, userId: string) {
  const baseSlug = slugify(slugInput ?? name);
  if (!baseSlug) throw new HttpError(400, "Invalid workspace name", "invalid_workspace_name");

  return db.transaction(async (tx) => {
    let slug: string | null = null;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const candidate = attempt === 0 ? baseSlug : `${baseSlug}-${attempt + 1}`;
      const [existing] = await tx.select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.slug, candidate)).limit(1);
      if (!existing) {
        slug = candidate;
        break;
      }
    }
    if (!slug) throw new HttpError(409, "Workspace slug is already taken", "workspace_slug_taken");

    const [workspace] = await tx.insert(workspaces).values({
      name,
      slug,
      createdByUserId: userId
    }).returning();

    await tx.insert(workspaceMembers).values({
      workspaceId: workspace.id,
      userId,
      role: "owner"
    });

    const [general] = await tx.insert(channels).values({
      workspaceId: workspace.id,
      name: "general",
      description: "Company-wide conversation",
      visibility: "public",
      autoJoin: true,
      createdByUserId: userId
    }).returning();

    const [conversation] = await tx.insert(conversations).values({
      workspaceId: workspace.id,
      type: "channel",
      channelId: general.id
    }).returning();

    await tx.insert(conversationMembers).values({
      workspaceId: workspace.id,
      conversationId: conversation.id,
      userId,
      role: "owner",
      lastReadAt: new Date()
    });

    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: userId,
      type: "workspace.created",
      entityType: "workspace",
      entityId: workspace.id,
      metadata: { defaultChannelId: general.id }
    });

    return { workspace, general, conversation };
  });
}

async function maybeCreateMentionNotifications(workspaceId: string, conversationId: string, messageId: string, senderId: string, bodyText: string) {
  const matches = Array.from(bodyText.matchAll(/@([a-zA-Z0-9._-]+)/g)).map((match) => match[1].toLowerCase());
  if (matches.length === 0) return;

  const members = await db
    .select({ userId: users.id, displayName: users.displayName, email: users.email })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, conversationId), isNull(conversationMembers.leftAt), isNull(conversationMembers.mutedAt)));

  const targets = members.filter((member) => {
    const names = [member.displayName.toLowerCase().replace(/\s+/g, "."), member.email.split("@")[0].toLowerCase()];
    return member.userId !== senderId && matches.some((mention) => names.includes(mention));
  });

  if (targets.length === 0) return;
  await createNotifications(targets.map((target) => ({
    workspaceId,
    userId: target.userId,
    type: "mention",
    actorUserId: senderId,
    conversationId,
    messageId
  })));
}

async function handleAuth(path: string, request: NextRequest) {
  if (path === "/auth/signup" && request.method === "POST") {
    const input = signupSchema.parse(await body(request, {}));
    const email = normalizeEmail(input.email);
    const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (existing) throw new HttpError(409, "Email is already registered", "email_taken");

    const verificationToken = newToken();
    const [user] = await db.transaction(async (tx) => {
      const [created] = await tx.insert(users).values({
        email,
        displayName: input.displayName,
        passwordHash: await hashPassword(input.password)
      }).returning();
      await tx.insert(emailVerificationTokens).values({
        userId: created.id,
        tokenHash: tokenHash(verificationToken),
        expiresAt: addDays(7)
      });
      return [created];
    });

    await createSession(user.id);
    await sendEmail({
      to: user.email,
      subject: "Verify your OpenChat email",
      text: `Verify your email: ${(process.env.APP_URL ?? "http://localhost:3000")}/verify-email/${verificationToken}`
    });
    return json({ user, verificationToken }, 201);
  }

  if (path === "/auth/login" && request.method === "POST") {
    const input = loginSchema.parse(await body(request, {}));
    const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(input.email))).limit(1);
    if (!user?.passwordHash || !(await verifyPassword(user.passwordHash, input.password))) {
      throw new HttpError(401, "Invalid email or password", "invalid_credentials");
    }
    await createSession(user.id);
    return json({ user });
  }

  if (path === "/auth/logout" && request.method === "POST") {
    await clearSession();
    return json({ ok: true });
  }

  if (path === "/auth/me" && request.method === "GET") {
    const user = await currentUser();
    if (!user) return json({ user: null, workspaces: [] });
    const memberships = await db
      .select({ workspace: workspaces, member: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt)));
    return json({ user, workspaces: memberships });
  }

  if (path === "/auth/forgot-password" && request.method === "POST") {
    const input = z.object({ email: z.string().email() }).parse(await body(request, {}));
    const [user] = await db.select().from(users).where(eq(users.email, normalizeEmail(input.email))).limit(1);
    if (user) {
      const token = newToken();
      await db.insert(passwordResetTokens).values({ userId: user.id, tokenHash: tokenHash(token), expiresAt: addHours(2) });
      await sendEmail({
        to: user.email,
        subject: "Reset your OpenChat password",
        text: `Reset your password: ${(process.env.APP_URL ?? "http://localhost:3000")}/reset-password/${token}`
      });
      return json({ ok: true, resetToken: token });
    }
    return json({ ok: true });
  }

  if (path === "/auth/reset-password" && request.method === "POST") {
    const input = z.object({ token: z.string().min(1), password: z.string().min(8) }).parse(await body(request, {}));
    const [record] = await db
      .select()
      .from(passwordResetTokens)
      .where(and(eq(passwordResetTokens.tokenHash, tokenHash(input.token)), isNull(passwordResetTokens.usedAt)))
      .limit(1);
    if (!record || record.expiresAt < new Date()) throw new HttpError(400, "Reset token is invalid or expired", "invalid_reset_token");
    await db.transaction(async (tx) => {
      await tx.update(users).set({ passwordHash: await hashPassword(input.password), updatedAt: new Date() }).where(eq(users.id, record.userId));
      await tx.update(passwordResetTokens).set({ usedAt: new Date() }).where(eq(passwordResetTokens.id, record.id));
    });
    return json({ ok: true });
  }

  if (path === "/auth/verify-email" && request.method === "POST") {
    const input = z.object({ token: z.string().min(1) }).parse(await body(request, {}));
    const [record] = await db
      .select()
      .from(emailVerificationTokens)
      .where(and(eq(emailVerificationTokens.tokenHash, tokenHash(input.token)), isNull(emailVerificationTokens.usedAt)))
      .limit(1);
    if (!record || record.expiresAt < new Date()) throw new HttpError(400, "Verification token is invalid or expired", "invalid_verification_token");
    await db.transaction(async (tx) => {
      await tx.update(users).set({ emailVerifiedAt: new Date(), updatedAt: new Date() }).where(eq(users.id, record.userId));
      await tx.update(emailVerificationTokens).set({ usedAt: new Date() }).where(eq(emailVerificationTokens.id, record.id));
    });
    return json({ ok: true });
  }

  return null;
}

async function handleWorkspaces(path: string, request: NextRequest) {
  if (path === "/workspaces" && request.method === "POST") {
    const user = await requireUser();
    const input = workspaceSchema.parse(await body(request, {}));
    const freeWorkspaceLimit = Number(process.env.FREE_WORKSPACE_LIMIT ?? 0);
    if (Number.isFinite(freeWorkspaceLimit) && freeWorkspaceLimit > 0) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(and(
          eq(workspaceMembers.userId, user.id),
          eq(workspaceMembers.role, "owner"),
          eq(workspaceMembers.status, "active"),
          isNull(workspaces.deletedAt)
        ));
      if (value >= freeWorkspaceLimit) {
        throw new HttpError(402, "Free workspace limit reached", "workspace_limit_reached");
      }
    }
    const result = await createDefaultWorkspace(input.name, input.slug, user.id);
    await publishRealtime("workspace.created", `user:${user.id}`, result.workspace);
    return json(result, 201);
  }

  if (path === "/workspaces" && request.method === "GET") {
    const user = await requireUser();
    const rows = await db
      .select({ workspace: workspaces, member: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt)));
    return json({ workspaces: rows });
  }

  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "workspaces" || !isUuid(parts[1])) return null;
  const workspaceId = parts[1];
  const user = await requireUser();

  if (parts.length === 2 && request.method === "GET") {
    await requireWorkspaceMember(workspaceId, user.id);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    return json({ workspace });
  }

  if (parts.length === 2 && request.method === "PATCH") {
    await requireWorkspaceAdmin(workspaceId, user.id);
    const input = z.object({
      name: z.string().min(2).max(120).optional(),
      logoUrl: z.string().url().nullable().optional(),
      plan: z.enum(["free", "starter", "team", "business"]).optional(),
      seatLimit: z.number().int().positive().optional(),
      overageAllowed: z.boolean().optional(),
      subscriptionStatus: z.enum(["active", "past_due", "grace_period", "read_only"]).optional(),
      gracePeriodEndsAt: z.coerce.date().nullable().optional(),
      readOnlyAt: z.coerce.date().nullable().optional()
    }).parse(await body(request, {}));
    const billingFields = ["plan", "seatLimit", "overageAllowed", "subscriptionStatus", "gracePeriodEndsAt", "readOnlyAt"] as const;
    if (billingFields.some((field) => input[field] !== undefined)) {
      await requireWorkspaceOwner(workspaceId, user.id);
    }
    const [workspace] = await db.update(workspaces).set({ ...input, updatedAt: new Date() }).where(eq(workspaces.id, workspaceId)).returning();
    await createAudit(workspaceId, user.id, "workspace.updated", "workspace", workspaceId, input);
    return json({ workspace });
  }

  if (parts.length === 2 && request.method === "DELETE") {
    await requireWorkspaceOwner(workspaceId, user.id);
    await db.update(workspaces).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    await createAudit(workspaceId, user.id, "workspace.deleted", "workspace", workspaceId);
    return json({ ok: true });
  }

  return { user, workspaceId, parts };
}

async function handleInvites(context: { user: Awaited<ReturnType<typeof requireUser>>; workspaceId: string; parts: string[] }, request: NextRequest) {
  const { user, workspaceId, parts } = context;
  if (parts[2] !== "invites") return null;

  if (request.method === "GET") {
    await requireWorkspaceAdmin(workspaceId, user.id);
    const invites = await db.select().from(workspaceInvites).where(eq(workspaceInvites.workspaceId, workspaceId)).orderBy(desc(workspaceInvites.createdAt));
    return json({ invites: invites.map(publicInvite) });
  }

  if (request.method === "POST") {
    await requireWorkspaceAdmin(workspaceId, user.id);
    await requireWorkspaceWritable(workspaceId);
    const input = inviteSchema.parse(await body(request, {}));
    const created = [];
    for (const rawEmail of input.emails) {
      const email = normalizeEmail(rawEmail);
      const [pending] = await db
        .select({ id: workspaceInvites.id })
        .from(workspaceInvites)
        .where(and(
          eq(workspaceInvites.workspaceId, workspaceId),
          eq(workspaceInvites.email, email),
          isNull(workspaceInvites.acceptedAt),
          isNull(workspaceInvites.revokedAt),
          gt(workspaceInvites.expiresAt, new Date())
        ))
        .limit(1);
      if (pending) throw new HttpError(409, `Pending invite already exists for ${email}`, "duplicate_pending_invite");
      const token = newToken();
      const [invite] = await db.insert(workspaceInvites).values({
        workspaceId,
        email,
        role: input.role,
        tokenHash: tokenHash(token),
        inviteType: "email",
        invitedByUserId: user.id,
        expiresAt: addDays(7)
      }).returning();
      created.push({ ...publicInvite(invite), token, inviteUrl: inviteUrl(token) });
      await sendEmail({
        to: email,
        subject: "You are invited to OpenChat",
        text: `Join the workspace: ${inviteUrl(token)}`
      });
    }
    await createAudit(workspaceId, user.id, "invite.created", "workspace_invite", undefined, { count: created.length });
    return json({ invites: created }, 201);
  }

  return null;
}

async function handleInviteActions(path: string, request: NextRequest) {
  if (path === "/invites/preview" && request.method === "POST") {
    const input = z.object({ token: z.string().min(1) }).parse(await body(request, {}));
    const [invite] = await db
      .select({ invite: workspaceInvites, workspace: workspaces })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .where(eq(workspaceInvites.tokenHash, tokenHash(input.token)))
      .limit(1);
    if (!invite || invite.invite.expiresAt < new Date() || invite.invite.revokedAt || invite.invite.acceptedAt) {
      throw new HttpError(400, "Invite is invalid or expired", "invalid_invite");
    }
    return json({ invite: publicInvite(invite.invite), workspace: invite.workspace });
  }

  if (path === "/invites/accept" && request.method === "POST") {
    const user = await requireUser();
    const input = z.object({ token: z.string().min(1) }).parse(await body(request, {}));
    const result = await db.transaction(async (tx) => {
      const [invite] = await tx.select().from(workspaceInvites).where(eq(workspaceInvites.tokenHash, tokenHash(input.token))).limit(1);
      if (!invite || invite.expiresAt < new Date() || invite.revokedAt || invite.acceptedAt) {
        throw new HttpError(400, "Invite is invalid or expired", "invalid_invite");
      }
      if (invite.email && normalizeEmail(invite.email) !== normalizeEmail(user.email)) {
        throw new HttpError(403, "Invite email does not match signed-in user", "invite_email_mismatch");
      }

      const [existing] = await tx.select().from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, user.id))).limit(1);
      if (existing?.status === "active") {
        const acceptedAt = new Date();
        await tx.update(workspaceInvites).set({ acceptedAt, useCount: invite.useCount + 1 }).where(eq(workspaceInvites.id, invite.id));
        await tx.insert(auditEvents).values({ workspaceId: invite.workspaceId, actorUserId: user.id, type: "invite.accepted", entityType: "workspace_invite", entityId: invite.id, metadata: { alreadyMember: true } });
        return { invite: publicInvite({ ...invite, acceptedAt, useCount: invite.useCount + 1 }), alreadyMember: true, notifications: [] };
      }
      await enforceSeatLimit(invite.workspaceId, 1);
      if (existing) {
        await tx.update(workspaceMembers).set({ role: invite.role, status: "active", removedAt: null, joinedAt: new Date() }).where(eq(workspaceMembers.id, existing.id));
      } else {
        await tx.insert(workspaceMembers).values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role });
      }

      const publicAutoJoin = await tx
        .select({ conversation: conversations })
        .from(channels)
        .innerJoin(conversations, eq(conversations.channelId, channels.id))
        .where(and(eq(channels.workspaceId, invite.workspaceId), eq(channels.autoJoin, true), eq(channels.visibility, "public")));
      if (publicAutoJoin.length > 0) {
        await tx.insert(conversationMembers).values(publicAutoJoin.map(({ conversation }) => ({
          workspaceId: invite.workspaceId,
          conversationId: conversation.id,
          userId: user.id,
          lastReadAt: new Date()
        }))).onConflictDoNothing();
      }
      await tx.update(workspaceInvites).set({ acceptedAt: new Date(), useCount: invite.useCount + 1 }).where(eq(workspaceInvites.id, invite.id));
      await tx.insert(auditEvents).values({ workspaceId: invite.workspaceId, actorUserId: user.id, type: "invite.accepted", entityType: "workspace_invite", entityId: invite.id });
      const admins = await tx.select({ userId: workspaceMembers.userId }).from(workspaceMembers).where(and(
        eq(workspaceMembers.workspaceId, invite.workspaceId),
        eq(workspaceMembers.status, "active"),
        or(eq(workspaceMembers.role, "owner"), eq(workspaceMembers.role, "admin"))
      ));
      const adminTargets = admins.filter((admin) => admin.userId !== user.id);
      const createdNotifications = adminTargets.length > 0
        ? await tx.insert(notifications).values(adminTargets.map((admin) => ({
          workspaceId: invite.workspaceId,
          userId: admin.userId,
          type: "invite_accepted",
          actorUserId: user.id
        }))).returning()
        : [];
      return { invite: publicInvite(invite), alreadyMember: false, notifications: createdNotifications };
    });
    if (!result.alreadyMember) {
      await publishRealtime("member.joined", `workspace:${result.invite.workspaceId}`, { userId: user.id });
    }
    await publishNotifications(result.notifications);
    return json({ invite: result.invite, alreadyMember: result.alreadyMember });
  }

  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "invites" && isUuid(parts[1]) && parts[2] === "revoke" && request.method === "POST") {
    const user = await requireUser();
    const [invite] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.id, parts[1])).limit(1);
    if (!invite) throw new HttpError(404, "Invite not found", "not_found");
    await requireWorkspaceAdmin(invite.workspaceId, user.id);
    await db.update(workspaceInvites).set({ revokedAt: new Date() }).where(eq(workspaceInvites.id, invite.id));
    await createAudit(invite.workspaceId, user.id, "invite.revoked", "workspace_invite", invite.id);
    return json({ ok: true });
  }

  if (parts[0] === "invites" && isUuid(parts[1]) && parts[2] === "resend" && request.method === "POST") {
    const user = await requireUser();
    const [invite] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.id, parts[1])).limit(1);
    if (!invite) throw new HttpError(404, "Invite not found", "not_found");
    await requireWorkspaceAdmin(invite.workspaceId, user.id);
    const token = newToken();
    await db.update(workspaceInvites).set({ tokenHash: tokenHash(token), expiresAt: addDays(7), revokedAt: null }).where(eq(workspaceInvites.id, invite.id));
    if (invite.email) {
      await sendEmail({
        to: invite.email,
        subject: "Your OpenChat invite",
        text: `Join the workspace: ${inviteUrl(token)}`
      });
    }
    await createAudit(invite.workspaceId, user.id, "invite.resent", "workspace_invite", invite.id);
    return json({ ok: true, token, inviteUrl: inviteUrl(token) });
  }

  return null;
}

async function handleChannels(context: { user: Awaited<ReturnType<typeof requireUser>>; workspaceId: string; parts: string[] }, request: NextRequest) {
  const { user, workspaceId, parts } = context;
  if (parts[2] !== "channels") return null;

  if (request.method === "GET") {
    await requireWorkspaceMember(workspaceId, user.id);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const rows = await db
      .select({ channel: channels, conversation: conversations, member: conversationMembers })
      .from(channels)
      .innerJoin(conversations, eq(conversations.channelId, channels.id))
      .leftJoin(conversationMembers, and(eq(conversationMembers.conversationId, conversations.id), eq(conversationMembers.userId, user.id), isNull(conversationMembers.leftAt)))
      .where(and(
        eq(channels.workspaceId, workspaceId),
        includeArchived ? undefined : isNull(channels.archivedAt),
        or(eq(channels.visibility, "public"), eq(conversationMembers.userId, user.id))
      ));
    const activity = await conversationActivityForUser(rows.map((row) => row.conversation.id), user.id);
    return json({
      channels: rows.map((row) => ({
        ...row,
        ...(activity.get(row.conversation.id) ?? { unreadCount: 0, mentionCount: 0 })
      }))
    });
  }

  if (request.method === "POST") {
    await requireWorkspaceMember(workspaceId, user.id);
    await requireWorkspaceWritable(workspaceId);
    const input = channelSchema.parse(await body(request, {}));
    const name = normalizeChannelName(input.name);
    if (!name) throw new HttpError(400, "Invalid channel name", "invalid_channel_name");
    const result = await db.transaction(async (tx) => {
      const [existingChannel] = await tx
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.workspaceId, workspaceId), eq(channels.name, name)))
        .limit(1);
      if (existingChannel) throw new HttpError(409, "Channel name already exists", "duplicate_channel_name");

      const requestedMemberIds = Array.from(new Set([user.id, ...(input.memberIds ?? [])]));
      const activeMembers = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(
          eq(workspaceMembers.workspaceId, workspaceId),
          eq(workspaceMembers.status, "active"),
          inArray(workspaceMembers.userId, requestedMemberIds)
        ));
      if (activeMembers.length !== requestedMemberIds.length) {
        throw new HttpError(400, "All channel members must be active workspace members", "invalid_channel_members");
      }

      const [channel] = await tx.insert(channels).values({
        workspaceId,
        name,
        visibility: input.visibility,
        description: input.description,
        topic: input.topic,
        createdByUserId: user.id
      }).returning();
      const [conversation] = await tx.insert(conversations).values({ workspaceId, type: "channel", channelId: channel.id }).returning();
      await tx.insert(conversationMembers).values(activeMembers.map((member) => ({
        workspaceId,
        conversationId: conversation.id,
        userId: member.userId,
        role: member.userId === user.id ? "creator" : null,
        lastReadAt: new Date()
      })));
      await tx.insert(auditEvents).values({ workspaceId, actorUserId: user.id, type: "channel.created", entityType: "channel", entityId: channel.id });
      return { channel, conversation };
    });
    await publishRealtime("channel.created", `workspace:${workspaceId}`, result);
    return json(result, 201);
  }

  return null;
}

async function handleChannelActions(path: string, request: NextRequest) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] !== "channels" || !isUuid(parts[1])) return null;
  const user = await requireUser();
  const channelId = parts[1];
  const [row] = await db
    .select({ channel: channels, conversation: conversations })
    .from(channels)
    .innerJoin(conversations, eq(conversations.channelId, channels.id))
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!row) throw new HttpError(404, "Channel not found", "not_found");

  if (request.method === "GET" && parts.length === 2) {
    await requireWorkspaceMember(row.channel.workspaceId, user.id);
    if (row.channel.visibility === "private") await requireConversationMember(row.conversation.id, user.id);
    return json(row);
  }

  if (request.method === "PATCH" && parts.length === 2) {
    await requireWorkspaceAdmin(row.channel.workspaceId, user.id);
    await requireWorkspaceWritable(row.channel.workspaceId);
    const input = z.object({ name: z.string().min(1).max(80).optional(), topic: z.string().nullable().optional(), description: z.string().nullable().optional() }).parse(await body(request, {}));
    const update: { name?: string; topic?: string | null; description?: string | null; updatedAt: Date } = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = normalizeChannelName(input.name);
      if (!name) throw new HttpError(400, "Invalid channel name", "invalid_channel_name");
      const [existingChannel] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.workspaceId, row.channel.workspaceId), eq(channels.name, name), ne(channels.id, channelId)))
        .limit(1);
      if (existingChannel) throw new HttpError(409, "Channel name already exists", "duplicate_channel_name");
      update.name = name;
    }
    if (input.topic !== undefined) update.topic = input.topic;
    if (input.description !== undefined) update.description = input.description;
    const [channel] = await db.update(channels).set(update).where(eq(channels.id, channelId)).returning();
    await createAudit(row.channel.workspaceId, user.id, "channel.updated", "channel", channelId, update);
    await publishRealtime("channel.updated", `workspace:${row.channel.workspaceId}`, channel);
    return json({ channel });
  }

  if (request.method === "POST" && parts[2] === "join") {
    await requireWorkspaceMember(row.channel.workspaceId, user.id);
    if (row.channel.visibility !== "public") throw new HttpError(403, "Private channels are invite-only", "private_channel");
    await db.insert(conversationMembers).values({ workspaceId: row.channel.workspaceId, conversationId: row.conversation.id, userId: user.id, lastReadAt: new Date() }).onConflictDoUpdate({
      target: [conversationMembers.conversationId, conversationMembers.userId],
      set: { leftAt: null, joinedAt: new Date() }
    });
    return json({ ok: true });
  }

  if (request.method === "POST" && parts[2] === "leave") {
    await requireConversationMember(row.conversation.id, user.id);
    if (row.channel.name === "general" && row.channel.autoJoin) throw new HttpError(400, "Cannot leave required #general channel", "required_channel");
    await db.update(conversationMembers).set({ leftAt: new Date() }).where(and(eq(conversationMembers.conversationId, row.conversation.id), eq(conversationMembers.userId, user.id)));
    return json({ ok: true });
  }

  if (request.method === "POST" && parts[2] === "archive") {
    await requireWorkspaceAdmin(row.channel.workspaceId, user.id);
    await requireWorkspaceWritable(row.channel.workspaceId);
    if (row.channel.name === "general") throw new HttpError(400, "#general cannot be archived", "required_channel");
    await db.update(channels).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(channels.id, channelId));
    await createAudit(row.channel.workspaceId, user.id, "channel.archived", "channel", channelId);
    await publishRealtime("channel.archived", `workspace:${row.channel.workspaceId}`, { channelId });
    return json({ ok: true });
  }

  if (request.method === "POST" && parts[2] === "unarchive") {
    await requireWorkspaceAdmin(row.channel.workspaceId, user.id);
    await requireWorkspaceWritable(row.channel.workspaceId);
    await db.update(channels).set({ archivedAt: null, updatedAt: new Date() }).where(eq(channels.id, channelId));
    await createAudit(row.channel.workspaceId, user.id, "channel.unarchived", "channel", channelId);
    await publishRealtime("channel.updated", `workspace:${row.channel.workspaceId}`, { channelId, archivedAt: null });
    return json({ ok: true });
  }

  if (request.method === "POST" && parts[2] === "members") {
    await requireWorkspaceAdmin(row.channel.workspaceId, user.id);
    await requireWorkspaceWritable(row.channel.workspaceId);
    const input = z.object({ userId: z.string().uuid() }).parse(await body(request, {}));
    await requireWorkspaceMember(row.channel.workspaceId, input.userId);
    await db.insert(conversationMembers).values({ workspaceId: row.channel.workspaceId, conversationId: row.conversation.id, userId: input.userId, lastReadAt: new Date() }).onConflictDoUpdate({
      target: [conversationMembers.conversationId, conversationMembers.userId],
      set: { leftAt: null, joinedAt: new Date() }
    });
    return json({ ok: true });
  }

  if (request.method === "DELETE" && parts[2] === "members" && isUuid(parts[3])) {
    await requireWorkspaceAdmin(row.channel.workspaceId, user.id);
    await db.update(conversationMembers).set({ leftAt: new Date() }).where(and(eq(conversationMembers.conversationId, row.conversation.id), eq(conversationMembers.userId, parts[3])));
    return json({ ok: true });
  }

  return null;
}

async function handleConversations(path: string, request: NextRequest) {
  const parts = path.split("/").filter(Boolean);
  if (parts[0] === "workspaces" && isUuid(parts[1]) && parts[2] === "conversations" && request.method === "GET") {
    const user = await requireUser();
    await requireWorkspaceMember(parts[1], user.id);
    const includeArchived = new URL(request.url).searchParams.get("includeArchived") === "true";
    const rows = await db
      .select({ conversation: conversations, channel: channels, member: conversationMembers })
      .from(conversationMembers)
      .innerJoin(conversations, eq(conversations.id, conversationMembers.conversationId))
      .leftJoin(channels, eq(channels.id, conversations.channelId))
      .where(and(
        eq(conversationMembers.workspaceId, parts[1]),
        eq(conversationMembers.userId, user.id),
        isNull(conversationMembers.leftAt),
        includeArchived ? undefined : or(isNull(conversations.channelId), isNull(channels.archivedAt))
      ));
    const activity = await conversationActivityForUser(rows.map((row) => row.conversation.id), user.id);
    return json({
      conversations: rows.map((row) => ({
        ...row,
        ...(activity.get(row.conversation.id) ?? { unreadCount: 0, mentionCount: 0 })
      }))
    });
  }

  if (parts[0] === "conversations" && parts[1] === "dm" && request.method === "POST") {
    const user = await requireUser();
    const input = z.object({ workspaceId: z.string().uuid(), userId: z.string().uuid() }).parse(await body(request, {}));
    await requireWorkspaceMember(input.workspaceId, user.id);
    await requireWorkspaceMember(input.workspaceId, input.userId);
    await requireWorkspaceWritable(input.workspaceId);
    if (input.userId === user.id) throw new HttpError(400, "Cannot DM yourself", "invalid_dm");

    const existing = await db.execute(sql`
      select c.*
      from conversations c
      join conversation_members cm1 on cm1.conversation_id = c.id and cm1.user_id = ${user.id}
      join conversation_members cm2 on cm2.conversation_id = c.id and cm2.user_id = ${input.userId}
      where c.workspace_id = ${input.workspaceId} and c.type = 'dm'
      limit 1
    `);
    if (existing.rows[0]) {
      const existingConversation = existing.rows[0] as { id: string };
      await db.update(conversationMembers).set({ leftAt: null, joinedAt: new Date() }).where(and(
        eq(conversationMembers.conversationId, existingConversation.id),
        inArray(conversationMembers.userId, [user.id, input.userId])
      ));
      return json({ conversation: existing.rows[0] });
    }

    const result = await db.transaction(async (tx) => {
      const [conversation] = await tx.insert(conversations).values({ workspaceId: input.workspaceId, type: "dm" }).returning();
      await tx.insert(conversationMembers).values([
        { workspaceId: input.workspaceId, conversationId: conversation.id, userId: user.id, lastReadAt: new Date() },
        { workspaceId: input.workspaceId, conversationId: conversation.id, userId: input.userId, lastReadAt: new Date() }
      ]);
      return conversation;
    });
    return json({ conversation: result }, 201);
  }

  if (parts[0] === "conversations" && isUuid(parts[1]) && request.method === "GET") {
    const user = await requireUser();
    const row = await requireConversationMember(parts[1], user.id);
    return json(row);
  }

  if (parts[0] === "conversations" && isUuid(parts[1]) && parts[2] === "read" && request.method === "POST") {
    const user = await requireUser();
    const { conversation } = await requireConversationMember(parts[1], user.id);
    const input = z.object({ messageId: z.string().uuid().optional() }).parse(await body(request, {}));
    await db.transaction(async (tx) => {
      await tx.update(conversationMembers).set({ lastReadMessageId: input.messageId, lastReadAt: new Date() }).where(and(eq(conversationMembers.conversationId, parts[1]), eq(conversationMembers.userId, user.id)));
      await tx.update(notifications).set({ readAt: new Date() }).where(and(
        eq(notifications.workspaceId, conversation.workspaceId),
        eq(notifications.conversationId, parts[1]),
        eq(notifications.userId, user.id),
        isNull(notifications.readAt)
      ));
    });
    await publishRealtime("conversation.read", `conversation:${parts[1]}`, { userId: user.id, messageId: input.messageId });
    return json({ ok: true });
  }

  if (parts[0] === "conversations" && isUuid(parts[1]) && parts[2] === "mute" && request.method === "POST") {
    const user = await requireUser();
    const { conversation } = await requireConversationMember(parts[1], user.id);
    await db.update(conversationMembers).set({ mutedAt: new Date() }).where(and(eq(conversationMembers.conversationId, parts[1]), eq(conversationMembers.userId, user.id)));
    await publishRealtime("conversation.muted", `user:${user.id}`, { workspaceId: conversation.workspaceId, conversationId: parts[1] });
    return json({ ok: true });
  }

  if (parts[0] === "conversations" && isUuid(parts[1]) && parts[2] === "unmute" && request.method === "POST") {
    const user = await requireUser();
    const { conversation } = await requireConversationMember(parts[1], user.id);
    await db.update(conversationMembers).set({ mutedAt: null }).where(and(eq(conversationMembers.conversationId, parts[1]), eq(conversationMembers.userId, user.id)));
    await publishRealtime("conversation.unmuted", `user:${user.id}`, { workspaceId: conversation.workspaceId, conversationId: parts[1] });
    return json({ ok: true });
  }

  return null;
}

async function handleMessages(path: string, request: NextRequest) {
  const parts = path.split("/").filter(Boolean);

  if (parts[0] === "conversations" && isUuid(parts[1]) && parts[2] === "messages") {
    const user = await requireUser();
    const { conversation } = await requireConversationMember(parts[1], user.id);

    if (request.method === "GET") {
      const rows = await db
        .select({ message: messages, sender: { id: users.id, displayName: users.displayName, email: users.email } })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.senderId))
        .where(and(eq(messages.conversationId, parts[1]), isNull(messages.parentMessageId)))
        .orderBy(desc(messages.createdAt))
        .limit(100);
      const parentIds = rows.map((row) => row.message.id);
      const threadStats = parentIds.length > 0
        ? await db
          .select({
            parentMessageId: messages.parentMessageId,
            replyCount: count(),
            lastReplyAt: sql<Date>`max(${messages.createdAt})`
          })
          .from(messages)
          .where(inArray(messages.parentMessageId, parentIds))
          .groupBy(messages.parentMessageId)
        : [];
      const reactionRows = parentIds.length > 0
        ? await db
          .select({
            messageId: messageReactions.messageId,
            emoji: messageReactions.emoji,
            userId: messageReactions.userId,
            displayName: users.displayName
          })
          .from(messageReactions)
          .innerJoin(users, eq(users.id, messageReactions.userId))
          .where(inArray(messageReactions.messageId, parentIds))
        : [];
      const statsByParent = new Map(threadStats.map((stat) => [stat.parentMessageId, stat]));
      const reactionsByMessage = new Map<string, Array<{ emoji: string; count: number; users: Array<{ id: string; displayName: string }> }>>();
      for (const reaction of reactionRows) {
        const existing = reactionsByMessage.get(reaction.messageId) ?? [];
        const aggregate = existing.find((item) => item.emoji === reaction.emoji);
        if (aggregate) {
          aggregate.count += 1;
          aggregate.users.push({ id: reaction.userId, displayName: reaction.displayName });
        } else {
          existing.push({ emoji: reaction.emoji, count: 1, users: [{ id: reaction.userId, displayName: reaction.displayName }] });
        }
        reactionsByMessage.set(reaction.messageId, existing);
      }
      return json({
        messages: rows.reverse().map((row) => ({
          ...row,
          thread: statsByParent.get(row.message.id) ?? { replyCount: 0, lastReplyAt: null },
          reactions: reactionsByMessage.get(row.message.id) ?? []
        }))
      });
    }

    if (request.method === "POST") {
      await requireWorkspaceWritable(conversation.workspaceId);
      const input = messageSchema.parse(await body(request, {}));
      const [channel] = conversation.channelId ? await db.select().from(channels).where(eq(channels.id, conversation.channelId)).limit(1) : [];
      if (channel?.archivedAt) throw new HttpError(400, "Archived channels are read-only", "channel_archived");
      if (input.parentMessageId) {
        const [parent] = await db
          .select({ id: messages.id, conversationId: messages.conversationId })
          .from(messages)
          .where(eq(messages.id, input.parentMessageId))
          .limit(1);
        if (!parent || parent.conversationId !== conversation.id) {
          throw new HttpError(400, "Thread parent must be in the same conversation", "invalid_thread_parent");
        }
      }

      const [message] = await db.insert(messages).values({
        workspaceId: conversation.workspaceId,
        conversationId: conversation.id,
        senderId: user.id,
        parentMessageId: input.parentMessageId,
        clientMessageId: input.clientMessageId,
        bodyText: input.bodyText
      }).onConflictDoNothing().returning();

      const created = message ?? (input.clientMessageId
        ? (await db.select().from(messages).where(and(eq(messages.senderId, user.id), eq(messages.clientMessageId, input.clientMessageId))).limit(1))[0]
        : null);
      if (!created) throw new HttpError(409, "Duplicate message", "duplicate_message");

      await maybeCreateMentionNotifications(conversation.workspaceId, conversation.id, created.id, user.id, input.bodyText);
      if (conversation.type === "dm") {
        const recipients = await db.select().from(conversationMembers).where(and(eq(conversationMembers.conversationId, conversation.id), ne(conversationMembers.userId, user.id), isNull(conversationMembers.leftAt), isNull(conversationMembers.mutedAt)));
        if (recipients.length > 0) {
          await createNotifications(recipients.map((recipient) => ({
            workspaceId: conversation.workspaceId,
            userId: recipient.userId,
            type: "dm",
            actorUserId: user.id,
            conversationId: conversation.id,
            messageId: created.id
          })));
        }
      }
      if (input.parentMessageId) {
        const participants = await db
          .selectDistinct({ userId: messages.senderId })
          .from(messages)
          .innerJoin(conversationMembers, and(
            eq(conversationMembers.conversationId, messages.conversationId),
            eq(conversationMembers.userId, messages.senderId),
            isNull(conversationMembers.leftAt),
            isNull(conversationMembers.mutedAt)
          ))
          .where(or(eq(messages.id, input.parentMessageId), eq(messages.parentMessageId, input.parentMessageId)));
        const targets = participants.filter((participant) => participant.userId !== user.id);
        if (targets.length > 0) {
          await createNotifications(targets.map((target) => ({
            workspaceId: conversation.workspaceId,
            userId: target.userId,
            type: "thread_reply",
            actorUserId: user.id,
            conversationId: conversation.id,
            messageId: created.id
          })));
        }
      }
      await publishRealtime("message.created", `conversation:${conversation.id}`, created);
      return json({ message: created }, 201);
    }
  }

  if (parts[0] === "messages" && isUuid(parts[1])) {
    const user = await requireUser();
    const [message] = await db.select().from(messages).where(eq(messages.id, parts[1])).limit(1);
    if (!message) throw new HttpError(404, "Message not found", "not_found");
    await requireConversationMember(message.conversationId, user.id);

    if (request.method === "PATCH") {
      if (message.senderId !== user.id) throw new HttpError(403, "Only the author can edit this message", "not_author");
      if (message.deletedAt) throw new HttpError(400, "Deleted messages cannot be edited", "message_deleted");
      const input = z.object({ bodyText: z.string().min(1).max(12000) }).parse(await body(request, {}));
      const [updated] = await db.update(messages).set({ bodyText: input.bodyText, editedAt: new Date() }).where(eq(messages.id, message.id)).returning();
      await publishRealtime("message.updated", `conversation:${message.conversationId}`, updated);
      return json({ message: updated });
    }

    if (request.method === "DELETE") {
      const member = await requireWorkspaceMember(message.workspaceId, user.id);
      if (message.senderId !== user.id && member.role !== "owner" && member.role !== "admin") {
        throw new HttpError(403, "Cannot delete this message", "delete_forbidden");
      }
      const [updated] = await db.update(messages).set({ deletedAt: new Date(), deletedByUserId: user.id }).where(eq(messages.id, message.id)).returning();
      await publishRealtime("message.deleted", `conversation:${message.conversationId}`, updated);
      return json({ message: updated });
    }

    if (request.method === "GET" && parts[2] === "thread") {
      const rows = await db
        .select({ message: messages, sender: { id: users.id, displayName: users.displayName, email: users.email } })
        .from(messages)
        .innerJoin(users, eq(users.id, messages.senderId))
        .where(or(eq(messages.id, message.id), eq(messages.parentMessageId, message.id)))
        .orderBy(messages.createdAt);
      return json({ messages: rows });
    }

    if (parts[2] === "reactions" && request.method === "GET") {
      const rows = await db
        .select({ reaction: messageReactions, user: { id: users.id, displayName: users.displayName, email: users.email } })
        .from(messageReactions)
        .innerJoin(users, eq(users.id, messageReactions.userId))
        .where(eq(messageReactions.messageId, message.id))
        .orderBy(messageReactions.createdAt);
      return json({ reactions: rows });
    }

    if (parts[2] === "reactions" && request.method === "POST") {
      const input = reactionSchema.parse(await body(request, {}));
      const [reaction] = await db.insert(messageReactions).values({ workspaceId: message.workspaceId, messageId: message.id, userId: user.id, emoji: input.emoji }).onConflictDoNothing().returning();
      await publishRealtime("reaction.created", `conversation:${message.conversationId}`, { messageId: message.id, reaction });
      return json({ reaction }, 201);
    }

    if (parts[2] === "reactions" && request.method === "DELETE") {
      const emoji = decodeURIComponent(parts[3] ?? "");
      await db.delete(messageReactions).where(and(eq(messageReactions.messageId, message.id), eq(messageReactions.userId, user.id), eq(messageReactions.emoji, emoji)));
      await publishRealtime("reaction.deleted", `conversation:${message.conversationId}`, { messageId: message.id, userId: user.id, emoji });
      return json({ ok: true });
    }
  }

  return null;
}

async function handleSearchAndAdmin(context: { user: Awaited<ReturnType<typeof requireUser>>; workspaceId: string; parts: string[] }, request: NextRequest) {
  const { user, workspaceId, parts } = context;

  if (parts[2] === "search" && request.method === "GET") {
    await requireWorkspaceMember(workspaceId, user.id);
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim();
    if (!q) return json({ results: [] });
    const sender = url.searchParams.get("sender");
    const conversation = url.searchParams.get("conversation");
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");
    const results = await db
      .select({ message: messages, sender: { id: users.id, displayName: users.displayName }, channel: channels })
      .from(messages)
      .innerJoin(users, eq(users.id, messages.senderId))
      .innerJoin(conversationMembers, and(eq(conversationMembers.conversationId, messages.conversationId), eq(conversationMembers.userId, user.id), isNull(conversationMembers.leftAt)))
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .leftJoin(channels, eq(channels.id, conversations.channelId))
      .where(and(
        eq(messages.workspaceId, workspaceId),
        isNull(messages.deletedAt),
        sql`to_tsvector('simple', coalesce(${messages.bodyText}, '')) @@ plainto_tsquery('simple', ${q})`,
        sender ? eq(messages.senderId, sender) : undefined,
        conversation ? eq(messages.conversationId, conversation) : undefined,
        from ? sql`${messages.createdAt} >= ${new Date(from)}` : undefined,
        to ? sql`${messages.createdAt} <= ${new Date(to)}` : undefined
      ))
      .orderBy(desc(messages.createdAt))
      .limit(50);
    return json({ results });
  }

  if (parts[2] === "members" && request.method === "GET") {
    const url = new URL(request.url);
    const includeRemoved = url.searchParams.get("includeRemoved") === "true";
    if (includeRemoved) {
      await requireWorkspaceAdmin(workspaceId, user.id);
    } else {
      await requireWorkspaceMember(workspaceId, user.id);
    }
    const rows = await db
      .select({ member: workspaceMembers, user: { id: users.id, email: users.email, displayName: users.displayName } })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(
        eq(workspaceMembers.workspaceId, workspaceId),
        includeRemoved ? undefined : eq(workspaceMembers.status, "active")
      ));
    return json({ members: rows });
  }

  if (parts[2] === "members" && isUuid(parts[3]) && request.method === "PATCH") {
    await requireWorkspaceOwner(workspaceId, user.id);
    const input = z.object({ role: z.enum(["owner", "admin", "member"]).optional(), status: z.enum(["active", "removed", "suspended"]).optional() }).parse(await body(request, {}));
    const [target] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, parts[3])).limit(1);
    if (!target || target.workspaceId !== workspaceId) throw new HttpError(404, "Member not found", "not_found");
    const wouldStopBeingActiveOwner = target.role === "owner" && (
      (input.role !== undefined && input.role !== "owner") ||
      (input.status !== undefined && input.status !== "active")
    );
    if (wouldStopBeingActiveOwner) {
      const [{ value }] = await db.select({ value: count() }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner"), eq(workspaceMembers.status, "active")));
      if (value <= 1) throw new HttpError(400, "Cannot demote last owner", "last_owner");
    }
    if (target.status !== "active" && input.status === "active") {
      await enforceSeatLimit(workspaceId, 1);
    }
    const update = {
      ...input,
      removedAt: input.status === "removed" ? new Date() : input.status === "active" ? null : undefined
    };
    const [member] = await db.update(workspaceMembers).set(update).where(eq(workspaceMembers.id, target.id)).returning();
    if (input.status === "removed" || input.status === "suspended") {
      await db.update(conversationMembers).set({ leftAt: new Date() }).where(and(eq(conversationMembers.workspaceId, workspaceId), eq(conversationMembers.userId, target.userId)));
    }
    await createAudit(workspaceId, user.id, "member.updated", "workspace_member", member.id, input);
    await publishRealtime("member.updated", `workspace:${workspaceId}`, { userId: target.userId, member });
    return json({ member });
  }

  if (parts[2] === "usage" && request.method === "GET") {
    await requireWorkspaceAdmin(workspaceId, user.id);
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    return json({ workspace, usage: await workspaceUsage(workspaceId) });
  }

  if (parts[2] === "members" && isUuid(parts[3]) && request.method === "DELETE") {
    const actor = await requireWorkspaceAdmin(workspaceId, user.id);
    const [target] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, parts[3])).limit(1);
    if (!target || target.workspaceId !== workspaceId) throw new HttpError(404, "Member not found", "not_found");
    if (target.role === "owner") {
      if (actor.role !== "owner") throw new HttpError(403, "Only owners can remove another owner", "owner_required");
      const [{ value }] = await db.select({ value: count() }).from(workspaceMembers).where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.role, "owner"), eq(workspaceMembers.status, "active")));
      if (value <= 1) throw new HttpError(400, "Cannot remove last owner", "last_owner");
    }
    await db.transaction(async (tx) => {
      await tx.update(workspaceMembers).set({ status: "removed", removedAt: new Date() }).where(eq(workspaceMembers.id, target.id));
      await tx.update(conversationMembers).set({ leftAt: new Date() }).where(and(eq(conversationMembers.workspaceId, workspaceId), eq(conversationMembers.userId, target.userId)));
    });
    await createAudit(workspaceId, user.id, "member.removed", "workspace_member", target.id);
    await publishRealtime("member.removed", `workspace:${workspaceId}`, { userId: target.userId });
    return json({ ok: true });
  }

  if (parts[2] === "audit-events" && request.method === "GET") {
    await requireWorkspaceAdmin(workspaceId, user.id);
    const rows = await db.select().from(auditEvents).where(eq(auditEvents.workspaceId, workspaceId)).orderBy(desc(auditEvents.createdAt)).limit(100);
    return json({ auditEvents: rows });
  }

  if (parts[2] === "exports" && request.method === "POST") {
    await requireWorkspaceOwner(workspaceId, user.id);
    const [job] = await db.insert(exportJobs).values({
      workspaceId,
      requestedByUserId: user.id,
      status: "queued",
      expiresAt: addDays(7)
    }).returning();
    await createAudit(workspaceId, user.id, "export.requested", "export_job", job.id);
    return json({ exportJob: job }, 202);
  }

  if (parts[2] === "exports" && request.method === "GET") {
    await requireWorkspaceOwner(workspaceId, user.id);
    const rows = await db.select().from(exportJobs).where(eq(exportJobs.workspaceId, workspaceId)).orderBy(desc(exportJobs.createdAt)).limit(20);
    return json({ exportJobs: rows });
  }

  if (parts[2] === "notifications" && request.method === "GET") {
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db.select().from(notifications).where(and(eq(notifications.workspaceId, workspaceId), eq(notifications.userId, user.id))).orderBy(desc(notifications.createdAt)).limit(50);
    return json({ notifications: rows });
  }

  if (parts[2] === "notifications" && parts[3] === "read" && request.method === "POST") {
    await requireWorkspaceMember(workspaceId, user.id);
    const input = z.object({ notificationIds: z.array(z.string().uuid()).optional() }).parse(await body(request, {}));
    await db.update(notifications).set({ readAt: new Date() }).where(and(
      eq(notifications.workspaceId, workspaceId),
      eq(notifications.userId, user.id),
      input.notificationIds?.length ? inArray(notifications.id, input.notificationIds) : isNull(notifications.readAt)
    ));
    return json({ ok: true });
  }

  return null;
}

async function dispatch(request: NextRequest, params: { path?: string[] }) {
  enforceCsrf(request);
  enforceRateLimit(request);
  const path = pathOf(params);
  const auth = await handleAuth(path, request);
  if (auth) return auth;

  const inviteAction = await handleInviteActions(path, request);
  if (inviteAction) return inviteAction;

  const channelAction = await handleChannelActions(path, request);
  if (channelAction) return channelAction;

  const conversation = await handleConversations(path, request);
  if (conversation) return conversation;

  const message = await handleMessages(path, request);
  if (message) return message;

  const workspace = await handleWorkspaces(path, request);
  if (workspace && "user" in workspace) {
    const invite = await handleInvites(workspace, request);
    if (invite) return invite;
    const channel = await handleChannels(workspace, request);
    if (channel) return channel;
    const searchOrAdmin = await handleSearchAndAdmin(workspace, request);
    if (searchOrAdmin) return searchOrAdmin;
  } else if (workspace) {
    return workspace;
  }

  throw new HttpError(404, "Route not found", "not_found");
}

export async function GET(request: NextRequest, { params }: Params) {
  try {
    return await dispatch(request, await params);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: NextRequest, { params }: Params) {
  try {
    return await dispatch(request, await params);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function PATCH(request: NextRequest, { params }: Params) {
  try {
    return await dispatch(request, await params);
  } catch (error) {
    return errorResponse(error);
  }
}

export async function DELETE(request: NextRequest, { params }: Params) {
  try {
    return await dispatch(request, await params);
  } catch (error) {
    return errorResponse(error);
  }
}
