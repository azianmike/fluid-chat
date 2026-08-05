import { and, desc, eq, gt, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditEvents,
  channels,
  conversationMembers,
  conversations,
  workspaceInvites,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import type { WorkspaceInvite } from "@/db/schema";
import { enforceSeatLimit, requireWorkspaceWritable } from "@/lib/billing";
import { sendEmail } from "@/lib/email";
import { HttpError, json } from "@/lib/http";
import { requireWorkspaceAdmin, requireWorkspaceMember } from "@/lib/permissions";
import { toWorkspace } from "@/lib/realtime";
import { addDays, newToken, normalizeEmail, tokenHash } from "@/lib/security";
import { defineRoutes } from "../router";
import { createAudit } from "../services/workspaces";
import { notify } from "../services/notifications";
import { toWorkspaceSummary } from "../services/serializers";

const appUrl = () => process.env.APP_URL ?? "http://localhost:3000";
const inviteUrl = (token: string) => `${appUrl()}/invite/${token}`;

function publicInvite(invite: WorkspaceInvite) {
  const { tokenHash: _hash, ...rest } = invite;
  void _hash;
  return rest;
}

export const inviteRoutes = defineRoutes({
  "GET /workspaces/:workspaceId/invites": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    const invites = await db
      .select()
      .from(workspaceInvites)
      .where(eq(workspaceInvites.workspaceId, workspaceId))
      .orderBy(desc(workspaceInvites.createdAt));
    return { invites: invites.map(publicInvite) };
  },

  "POST /workspaces/:workspaceId/invites": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    const member = await requireWorkspaceMember(workspaceId, user.id);
    const workspace = await requireWorkspaceWritable(workspaceId);
    const isAdmin = member.role === "owner" || member.role === "admin";
    if (member.role === "guest") {
      throw new HttpError(403, "Guests cannot invite people", "invite_restricted");
    }
    if (!isAdmin && !workspace.membersCanInvite) {
      throw new HttpError(403, "Only admins can invite people to this workspace", "invite_restricted");
    }

    const input = await ctx.input(
      z.object({
        emails: z.array(z.string().email()).min(1).max(50),
        role: z.enum(["admin", "member", "guest"]).default("member")
      })
    );
    if (input.role === "admin" && !isAdmin) {
      throw new HttpError(403, "Only admins can invite admins", "admin_required");
    }

    const created = [];
    const skipped: string[] = [];
    for (const rawEmail of input.emails) {
      const email = normalizeEmail(rawEmail);
      const [pending] = await db
        .select({ id: workspaceInvites.id })
        .from(workspaceInvites)
        .where(
          and(
            eq(workspaceInvites.workspaceId, workspaceId),
            eq(workspaceInvites.email, email),
            isNull(workspaceInvites.acceptedAt),
            isNull(workspaceInvites.revokedAt),
            gt(workspaceInvites.expiresAt, new Date())
          )
        )
        .limit(1);
      if (pending) {
        skipped.push(email);
        continue;
      }

      const token = newToken();
      const [invite] = await db
        .insert(workspaceInvites)
        .values({
          workspaceId,
          email,
          role: input.role,
          tokenHash: tokenHash(token),
          inviteType: "email",
          invitedByUserId: user.id,
          expiresAt: addDays(7)
        })
        .returning();
      created.push({ ...publicInvite(invite), token, inviteUrl: inviteUrl(token) });
      await sendEmail({
        to: email,
        subject: `Join ${workspace.name} on Fluid Chat`,
        text: `${user.displayName} invited you to ${workspace.name}.\n\nJoin here: ${inviteUrl(token)}`
      });
    }

    await createAudit(workspaceId, user.id, "invite.created", "workspace_invite", undefined, { count: created.length });
    return json({ invites: created, skipped }, 201);
  },

  "POST /workspaces/:workspaceId/invite-links": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    await requireWorkspaceWritable(workspaceId);
    const input = await ctx.input(
      z.object({
        role: z.enum(["member", "guest"]).default("member"),
        maxUses: z.number().int().min(1).max(500).optional(),
        expiresInDays: z.number().int().min(1).max(90).default(30)
      })
    );
    const token = newToken();
    const [invite] = await db
      .insert(workspaceInvites)
      .values({
        workspaceId,
        email: null,
        role: input.role,
        tokenHash: tokenHash(token),
        inviteType: "link",
        invitedByUserId: user.id,
        maxUses: input.maxUses ?? null,
        expiresAt: addDays(input.expiresInDays)
      })
      .returning();
    await createAudit(workspaceId, user.id, "invite_link.created", "workspace_invite", invite.id);
    return json({ invite: publicInvite(invite), token, inviteUrl: inviteUrl(token) }, 201);
  },

  "POST /invites/preview": async (ctx) => {
    const input = await ctx.input(z.object({ token: z.string().min(1) }));
    const [row] = await db
      .select({ invite: workspaceInvites, workspace: workspaces })
      .from(workspaceInvites)
      .innerJoin(workspaces, eq(workspaces.id, workspaceInvites.workspaceId))
      .where(eq(workspaceInvites.tokenHash, tokenHash(input.token)))
      .limit(1);
    if (!row || !isUsable(row.invite)) throw new HttpError(400, "Invite is invalid or expired", "invalid_invite");
    return {
      invite: { email: row.invite.email, role: row.invite.role, inviteType: row.invite.inviteType },
      workspace: toWorkspaceSummary(row.workspace)
    };
  },

  "POST /invites/accept": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(z.object({ token: z.string().min(1) }));

    const result = await db.transaction(async (tx) => {
      const [invite] = await tx
        .select()
        .from(workspaceInvites)
        .where(eq(workspaceInvites.tokenHash, tokenHash(input.token)))
        .limit(1);
      if (!invite || !isUsable(invite)) throw new HttpError(400, "Invite is invalid or expired", "invalid_invite");
      if (invite.email && normalizeEmail(invite.email) !== normalizeEmail(user.email)) {
        throw new HttpError(403, "This invite was sent to a different email address", "invite_email_mismatch");
      }

      const [existing] = await tx
        .select()
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, invite.workspaceId), eq(workspaceMembers.userId, user.id)))
        .limit(1);

      if (existing?.status === "active") {
        return { workspaceId: invite.workspaceId, alreadyMember: true, adminIds: [] as string[] };
      }

      await enforceSeatLimit(invite.workspaceId, 1);

      if (existing) {
        await tx
          .update(workspaceMembers)
          .set({ role: invite.role, status: "active", removedAt: null, joinedAt: new Date() })
          .where(eq(workspaceMembers.id, existing.id));
      } else {
        await tx
          .insert(workspaceMembers)
          .values({ workspaceId: invite.workspaceId, userId: user.id, role: invite.role });
      }

      const autoJoin = await tx
        .select({ conversation: conversations })
        .from(channels)
        .innerJoin(conversations, eq(conversations.channelId, channels.id))
        .where(
          and(
            eq(channels.workspaceId, invite.workspaceId),
            eq(channels.autoJoin, true),
            eq(channels.visibility, "public"),
            isNull(channels.archivedAt)
          )
        );
      if (autoJoin.length > 0) {
        await tx
          .insert(conversationMembers)
          .values(
            autoJoin.map(({ conversation }) => ({
              workspaceId: invite.workspaceId,
              conversationId: conversation.id,
              userId: user.id,
              lastReadAt: new Date()
            }))
          )
          .onConflictDoNothing();
      }

      const uses = invite.useCount + 1;
      const exhausted = invite.inviteType === "email" || (invite.maxUses !== null && uses >= invite.maxUses);
      await tx
        .update(workspaceInvites)
        .set({ useCount: uses, acceptedAt: exhausted ? new Date() : invite.acceptedAt })
        .where(eq(workspaceInvites.id, invite.id));

      await tx.insert(auditEvents).values({
        workspaceId: invite.workspaceId,
        actorUserId: user.id,
        type: "invite.accepted",
        entityType: "workspace_invite",
        entityId: invite.id
      });

      const admins = await tx
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.workspaceId, invite.workspaceId),
            eq(workspaceMembers.status, "active"),
            or(eq(workspaceMembers.role, "owner"), eq(workspaceMembers.role, "admin"))
          )
        );

      return {
        workspaceId: invite.workspaceId,
        alreadyMember: false,
        adminIds: admins.map((admin) => admin.userId).filter((id) => id !== user.id)
      };
    });

    if (!result.alreadyMember) {
      await toWorkspace(result.workspaceId, { type: "member.changed", userId: user.id });
      await notify({
        workspaceId: result.workspaceId,
        type: "invite_accepted",
        actorUserId: user.id,
        body: `${user.displayName} joined the workspace`,
        userIds: result.adminIds
      });
    }

    return { workspaceId: result.workspaceId, alreadyMember: result.alreadyMember };
  },

  "POST /invites/:inviteId/revoke": async (ctx) => {
    const user = await ctx.user();
    const inviteId = ctx.param("inviteId");
    const [invite] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.id, inviteId)).limit(1);
    if (!invite) throw new HttpError(404, "Invite not found", "not_found");
    await requireWorkspaceAdmin(invite.workspaceId, user.id);
    await db.update(workspaceInvites).set({ revokedAt: new Date() }).where(eq(workspaceInvites.id, invite.id));
    await createAudit(invite.workspaceId, user.id, "invite.revoked", "workspace_invite", invite.id);
    return { ok: true };
  },

  "POST /invites/:inviteId/resend": async (ctx) => {
    const user = await ctx.user();
    const inviteId = ctx.param("inviteId");
    const [invite] = await db.select().from(workspaceInvites).where(eq(workspaceInvites.id, inviteId)).limit(1);
    if (!invite) throw new HttpError(404, "Invite not found", "not_found");
    await requireWorkspaceAdmin(invite.workspaceId, user.id);

    const token = newToken();
    await db
      .update(workspaceInvites)
      .set({ tokenHash: tokenHash(token), expiresAt: addDays(7), revokedAt: null })
      .where(eq(workspaceInvites.id, invite.id));
    if (invite.email) {
      await sendEmail({
        to: invite.email,
        subject: "Your Fluid Chat invite",
        text: `Join the workspace: ${inviteUrl(token)}`
      });
    }
    await createAudit(invite.workspaceId, user.id, "invite.resent", "workspace_invite", invite.id);
    return { ok: true, token, inviteUrl: inviteUrl(token) };
  }
});

function isUsable(invite: WorkspaceInvite) {
  if (invite.revokedAt) return false;
  if (invite.expiresAt < new Date()) return false;
  if (invite.inviteType === "email") return !invite.acceptedAt;
  if (invite.maxUses !== null && invite.useCount >= invite.maxUses) return false;
  return true;
}
