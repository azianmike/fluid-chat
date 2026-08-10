import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  auditEvents,
  conversationMembers,
  customEmoji,
  exportJobs,
  files,
  sidebarSections,
  userGroupMembers,
  userGroups,
  users,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import { enforceSeatLimit, workspaceStorage, workspaceUsage } from "@/lib/billing";
import { HttpError, json } from "@/lib/http";
import {
  requireWorkspaceAdmin,
  requireWorkspaceMember,
  requireWorkspaceOwner
} from "@/lib/permissions";
import { toUser, toWorkspace } from "@/lib/realtime";
import { addDays } from "@/lib/security";
import { defineRoutes } from "../router";
import { toPublicUser, toWorkspaceSummary } from "../services/serializers";
import { bootstrapWorkspace, createAudit, createWorkspace } from "../services/workspaces";
import { workspaceById } from "../services/conversations";

const settingsSchema = z.object({
  name: z.string().min(2).max(120).optional(),
  description: z.string().max(500).nullable().optional(),
  iconEmoji: z.string().max(64).nullable().optional(),
  logoUrl: z.string().max(500).nullable().optional(),
  membersCanInvite: z.boolean().optional(),
  membersCanCreateChannels: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
  plan: z.enum(["free", "starter", "team", "business"]).optional(),
  seatLimit: z.number().int().positive().optional(),
  // null falls back to the deployment default, 0 is unlimited.
  storageLimitBytes: z.number().int().min(0).nullable().optional(),
  overageAllowed: z.boolean().optional(),
  subscriptionStatus: z.enum(["active", "past_due", "grace_period", "read_only"]).optional(),
  gracePeriodEndsAt: z.coerce.date().nullable().optional(),
  readOnlyAt: z.coerce.date().nullable().optional()
});

const billingFields = [
  "plan",
  "seatLimit",
  "storageLimitBytes",
  "overageAllowed",
  "subscriptionStatus",
  "gracePeriodEndsAt",
  "readOnlyAt"
] as const;

export const workspaceRoutes = defineRoutes({
  "POST /workspaces": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(z.object({ name: z.string().min(2).max(120), slug: z.string().min(2).max(64).optional() }));

    const limit = Number(process.env.FREE_WORKSPACE_LIMIT ?? 0);
    if (Number.isFinite(limit) && limit > 0) {
      const [{ value }] = await db
        .select({ value: count() })
        .from(workspaceMembers)
        .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
        .where(
          and(
            eq(workspaceMembers.userId, user.id),
            eq(workspaceMembers.role, "owner"),
            eq(workspaceMembers.status, "active"),
            isNull(workspaces.deletedAt)
          )
        );
      if (value >= limit) throw new HttpError(402, "Free workspace limit reached", "workspace_limit_reached");
    }

    const result = await createWorkspace({ name: input.name, slug: input.slug, creator: user });
    return json({ workspace: toWorkspaceSummary(result.workspace), channels: result.channels }, 201);
  },

  "GET /workspaces": async (ctx) => {
    const user = await ctx.user();
    const rows = await db
      .select({ workspace: workspaces, member: workspaceMembers })
      .from(workspaceMembers)
      .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
      .where(and(eq(workspaceMembers.userId, user.id), eq(workspaceMembers.status, "active"), isNull(workspaces.deletedAt)));
    return {
      workspaces: rows.map((row) => ({
        workspace: toWorkspaceSummary(row.workspace),
        role: row.member.role,
        memberId: row.member.id
      }))
    };
  },

  "GET /workspaces/:workspaceId": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    return { workspace: toWorkspaceSummary(await workspaceById(workspaceId)) };
  },

  "GET /workspaces/:workspaceId/bootstrap": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    return bootstrapWorkspace(await workspaceById(workspaceId), user);
  },

  "PATCH /workspaces/:workspaceId": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    const input = await ctx.input(settingsSchema);
    if (billingFields.some((field) => input[field] !== undefined)) {
      await requireWorkspaceOwner(workspaceId, user.id);
    }
    const [workspace] = await db
      .update(workspaces)
      .set({ ...input, updatedAt: new Date() })
      .where(eq(workspaces.id, workspaceId))
      .returning();
    await createAudit(workspaceId, user.id, "workspace.updated", "workspace", workspaceId, input);
    return { workspace: toWorkspaceSummary(workspace) };
  },

  "DELETE /workspaces/:workspaceId": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceOwner(workspaceId, user.id);
    await db.update(workspaces).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(workspaces.id, workspaceId));
    await createAudit(workspaceId, user.id, "workspace.deleted", "workspace", workspaceId);
    return { ok: true };
  },

  /* ---------------------------------------------------------------- members */

  "GET /workspaces/:workspaceId/members": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    const includeRemoved = ctx.queryFlag("includeRemoved");
    if (includeRemoved) await requireWorkspaceAdmin(workspaceId, user.id);
    else await requireWorkspaceMember(workspaceId, user.id);

    const rows = await db
      .select({ member: workspaceMembers, user: users })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(
        and(
          eq(workspaceMembers.workspaceId, workspaceId),
          includeRemoved ? undefined : eq(workspaceMembers.status, "active")
        )
      );
    return {
      members: rows.map((row) => ({
        memberId: row.member.id,
        role: row.member.role,
        status: row.member.status,
        joinedAt: new Date(row.member.joinedAt).toISOString(),
        user: toPublicUser(row.user)
      }))
    };
  },

  "PATCH /workspaces/:workspaceId/members/:memberId": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    const memberId = ctx.param("memberId");
    await requireWorkspaceOwner(workspaceId, user.id);
    const input = await ctx.input(
      z.object({
        role: z.enum(["owner", "admin", "member", "guest"]).optional(),
        status: z.enum(["active", "removed", "suspended"]).optional()
      })
    );

    const [target] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, memberId)).limit(1);
    if (!target || target.workspaceId !== workspaceId) throw new HttpError(404, "Member not found", "not_found");

    const losingOwner =
      target.role === "owner" &&
      ((input.role !== undefined && input.role !== "owner") || (input.status !== undefined && input.status !== "active"));
    if (losingOwner) await assertAnotherOwnerExists(workspaceId);
    if (target.status !== "active" && input.status === "active") await enforceSeatLimit(workspaceId, 1);

    const [member] = await db
      .update(workspaceMembers)
      .set({
        ...input,
        removedAt: input.status === "removed" ? new Date() : input.status === "active" ? null : undefined
      })
      .where(eq(workspaceMembers.id, target.id))
      .returning();

    if (input.status === "removed" || input.status === "suspended") {
      await db
        .update(conversationMembers)
        .set({ leftAt: new Date() })
        .where(and(eq(conversationMembers.workspaceId, workspaceId), eq(conversationMembers.userId, target.userId)));
    }

    await createAudit(workspaceId, user.id, "member.updated", "workspace_member", member.id, input);
    await toWorkspace(workspaceId, { type: "member.changed", userId: target.userId });
    return { member: { memberId: member.id, role: member.role, status: member.status } };
  },

  "DELETE /workspaces/:workspaceId/members/:memberId": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    const memberId = ctx.param("memberId");
    const actor = await requireWorkspaceAdmin(workspaceId, user.id);
    const [target] = await db.select().from(workspaceMembers).where(eq(workspaceMembers.id, memberId)).limit(1);
    if (!target || target.workspaceId !== workspaceId) throw new HttpError(404, "Member not found", "not_found");
    if (target.role === "owner") {
      if (actor.role !== "owner") throw new HttpError(403, "Only owners can remove another owner", "owner_required");
      await assertAnotherOwnerExists(workspaceId);
    }

    await db.transaction(async (tx) => {
      await tx
        .update(workspaceMembers)
        .set({ status: "removed", removedAt: new Date() })
        .where(eq(workspaceMembers.id, target.id));
      await tx
        .update(conversationMembers)
        .set({ leftAt: new Date() })
        .where(and(eq(conversationMembers.workspaceId, workspaceId), eq(conversationMembers.userId, target.userId)));
    });

    await createAudit(workspaceId, user.id, "member.removed", "workspace_member", target.id);
    await toWorkspace(workspaceId, { type: "member.changed", userId: target.userId });
    await toUser(target.userId, { type: "member.changed", userId: target.userId });
    return { ok: true };
  },

  /* ---------------------------------------------------------------- billing */

  "GET /workspaces/:workspaceId/usage": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    const [fileCount] = await db
      .select({ value: count() })
      .from(files)
      .where(and(eq(files.workspaceId, workspaceId), isNull(files.deletedAt)));
    const storage = await workspaceStorage(workspaceId);
    return {
      workspace: toWorkspaceSummary(await workspaceById(workspaceId)),
      usage: {
        ...(await workspaceUsage(workspaceId)),
        fileCount: fileCount?.value ?? 0,
        storageBytes: storage.usedBytes,
        storageLimitBytes: storage.limitBytes
      }
    };
  },

  "GET /workspaces/:workspaceId/audit-events": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    const rows = await db
      .select({ event: auditEvents, actor: users })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorUserId))
      .where(eq(auditEvents.workspaceId, workspaceId))
      .orderBy(desc(auditEvents.createdAt))
      .limit(ctx.queryInt("limit", 100));
    return {
      auditEvents: rows.map((row) => ({
        ...row.event,
        actor: row.actor ? { id: row.actor.id, displayName: row.actor.displayName } : null
      }))
    };
  },

  "POST /workspaces/:workspaceId/exports": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceOwner(workspaceId, user.id);
    const [job] = await db
      .insert(exportJobs)
      .values({ workspaceId, requestedByUserId: user.id, status: "queued", expiresAt: addDays(7) })
      .returning();
    await createAudit(workspaceId, user.id, "export.requested", "export_job", job.id);
    return json({ exportJob: job }, 202);
  },

  "GET /workspaces/:workspaceId/exports": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceOwner(workspaceId, user.id);
    const rows = await db
      .select()
      .from(exportJobs)
      .where(eq(exportJobs.workspaceId, workspaceId))
      .orderBy(desc(exportJobs.createdAt))
      .limit(20);
    return { exportJobs: rows };
  },

  /* --------------------------------------------------------------- sections */

  "POST /workspaces/:workspaceId/sections": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const input = await ctx.input(
      z.object({ name: z.string().min(1).max(60), emoji: z.string().max(64).optional(), position: z.number().int().optional() })
    );
    const [section] = await db
      .insert(sidebarSections)
      .values({
        workspaceId,
        userId: user.id,
        name: input.name,
        emoji: input.emoji ?? null,
        position: input.position ?? 0
      })
      .returning();
    return json({ section }, 201);
  },

  "PATCH /sections/:sectionId": async (ctx) => {
    const user = await ctx.user();
    const sectionId = ctx.param("sectionId");
    const input = await ctx.input(
      z.object({
        name: z.string().min(1).max(60).optional(),
        emoji: z.string().max(64).nullable().optional(),
        position: z.number().int().optional(),
        collapsed: z.boolean().optional()
      })
    );
    const [section] = await db
      .update(sidebarSections)
      .set(input)
      .where(and(eq(sidebarSections.id, sectionId), eq(sidebarSections.userId, user.id)))
      .returning();
    if (!section) throw new HttpError(404, "Section not found", "not_found");
    return { section };
  },

  "DELETE /sections/:sectionId": async (ctx) => {
    const user = await ctx.user();
    const sectionId = ctx.param("sectionId");
    await db.delete(sidebarSections).where(and(eq(sidebarSections.id, sectionId), eq(sidebarSections.userId, user.id)));
    return { ok: true };
  },

  /* ------------------------------------------------------------ custom emoji */

  "GET /workspaces/:workspaceId/emoji": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const rows = await db.select().from(customEmoji).where(eq(customEmoji.workspaceId, workspaceId));
    return { emoji: rows };
  },

  "POST /workspaces/:workspaceId/emoji": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const input = await ctx.input(
      z.object({
        name: z
          .string()
          .min(2)
          .max(64)
          .regex(/^[a-z0-9_+-]+$/i, "Emoji names use letters, numbers, dashes and underscores"),
        fileId: z.string().uuid()
      })
    );
    const [file] = await db
      .select()
      .from(files)
      .where(and(eq(files.id, input.fileId), eq(files.workspaceId, workspaceId)))
      .limit(1);
    if (!file) throw new HttpError(404, "Upload the image first", "not_found");

    const [created] = await db
      .insert(customEmoji)
      .values({
        workspaceId,
        name: input.name.toLowerCase(),
        fileId: file.id,
        imageUrl: `/api/files/${file.id}/download`,
        createdByUserId: user.id
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new HttpError(409, "That emoji name is taken", "emoji_taken");
    await toWorkspace(workspaceId, { type: "member.changed", userId: user.id });
    return json({ emoji: created }, 201);
  },

  "DELETE /emoji/:emojiId": async (ctx) => {
    const user = await ctx.user();
    const emojiId = ctx.param("emojiId");
    const [emoji] = await db.select().from(customEmoji).where(eq(customEmoji.id, emojiId)).limit(1);
    if (!emoji) throw new HttpError(404, "Emoji not found", "not_found");
    const member = await requireWorkspaceMember(emoji.workspaceId, user.id);
    if (emoji.createdByUserId !== user.id && member.role !== "owner" && member.role !== "admin") {
      throw new HttpError(403, "Only the creator or an admin can remove this emoji", "forbidden");
    }
    await db.delete(customEmoji).where(eq(customEmoji.id, emoji.id));
    return { ok: true };
  },

  /* ------------------------------------------------------------- user groups */

  "GET /workspaces/:workspaceId/user-groups": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    const groups = await db
      .select()
      .from(userGroups)
      .where(and(eq(userGroups.workspaceId, workspaceId), isNull(userGroups.deletedAt)));
    const memberships =
      groups.length > 0
        ? await db.select().from(userGroupMembers).where(inArray(userGroupMembers.groupId, groups.map((group) => group.id)))
        : [];
    return {
      groups: groups.map((group) => ({
        ...group,
        memberIds: memberships.filter((row) => row.groupId === group.id).map((row) => row.userId)
      }))
    };
  },

  "POST /workspaces/:workspaceId/user-groups": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceAdmin(workspaceId, user.id);
    const input = await ctx.input(
      z.object({
        handle: z
          .string()
          .min(2)
          .max(40)
          .regex(/^[a-z0-9-]+$/i),
        name: z.string().min(1).max(80),
        description: z.string().max(300).optional(),
        memberIds: z.array(z.string().uuid()).max(500).optional()
      })
    );
    const [group] = await db
      .insert(userGroups)
      .values({
        workspaceId,
        handle: input.handle.toLowerCase(),
        name: input.name,
        description: input.description ?? null,
        createdByUserId: user.id
      })
      .onConflictDoNothing()
      .returning();
    if (!group) throw new HttpError(409, "That handle is taken", "handle_taken");
    if (input.memberIds?.length) {
      await db
        .insert(userGroupMembers)
        .values(input.memberIds.map((userId) => ({ groupId: group.id, userId })))
        .onConflictDoNothing();
    }
    await createAudit(workspaceId, user.id, "user_group.created", "user_group", group.id);
    return json({ group }, 201);
  },

  "PATCH /user-groups/:groupId": async (ctx) => {
    const user = await ctx.user();
    const groupId = ctx.param("groupId");
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).limit(1);
    if (!group) throw new HttpError(404, "Group not found", "not_found");
    await requireWorkspaceAdmin(group.workspaceId, user.id);
    const input = await ctx.input(
      z.object({
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(300).nullable().optional(),
        memberIds: z.array(z.string().uuid()).max(500).optional()
      })
    );
    const [updated] = await db
      .update(userGroups)
      .set({ name: input.name, description: input.description, updatedAt: new Date() })
      .where(eq(userGroups.id, group.id))
      .returning();
    if (input.memberIds) {
      await db.delete(userGroupMembers).where(eq(userGroupMembers.groupId, group.id));
      if (input.memberIds.length > 0) {
        await db.insert(userGroupMembers).values(input.memberIds.map((userId) => ({ groupId: group.id, userId })));
      }
    }
    return { group: updated };
  },

  "DELETE /user-groups/:groupId": async (ctx) => {
    const user = await ctx.user();
    const groupId = ctx.param("groupId");
    const [group] = await db.select().from(userGroups).where(eq(userGroups.id, groupId)).limit(1);
    if (!group) throw new HttpError(404, "Group not found", "not_found");
    await requireWorkspaceAdmin(group.workspaceId, user.id);
    await db.update(userGroups).set({ deletedAt: new Date() }).where(eq(userGroups.id, group.id));
    return { ok: true };
  }
});

async function assertAnotherOwnerExists(workspaceId: string) {
  const [{ value }] = await db
    .select({ value: count() })
    .from(workspaceMembers)
    .where(
      and(
        eq(workspaceMembers.workspaceId, workspaceId),
        eq(workspaceMembers.role, "owner"),
        eq(workspaceMembers.status, "active")
      )
    );
  if (value <= 1) throw new HttpError(400, "A workspace must always have an owner", "last_owner");
}
