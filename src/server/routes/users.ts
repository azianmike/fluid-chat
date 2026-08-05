import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { users, workspaceMembers } from "@/db/schema";
import type { UserPreferences } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { requireWorkspaceMember } from "@/lib/permissions";
import { defineRoutes } from "../router";
import { toPublicUser, toSessionUser } from "../services/serializers";
import { broadcastUserUpdate, heartbeat, setPresence, setStatus } from "../services/presence";
import { workspaceMentionDirectory } from "../services/mentions";

const profileSchema = z.object({
  displayName: z.string().min(1).max(120).optional(),
  handle: z
    .string()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9._-]+$/i, "Handles use letters, numbers, dots, dashes and underscores")
    .optional(),
  title: z.string().max(120).nullable().optional(),
  pronouns: z.string().max(40).nullable().optional(),
  phone: z.string().max(40).nullable().optional(),
  timezone: z.string().max(60).optional(),
  avatarUrl: z.string().max(500).nullable().optional(),
  avatarColor: z
    .string()
    .regex(/^#[0-9a-f]{6}$/i)
    .nullable()
    .optional()
});

const preferencesSchema = z.object({
  theme: z.enum(["light", "dark", "system"]).optional(),
  messageDensity: z.enum(["comfortable", "compact"]).optional(),
  timeFormat: z.enum(["12h", "24h"]).optional(),
  enterToSend: z.boolean().optional(),
  showUnreadsFirst: z.boolean().optional(),
  emailNotifications: z.enum(["all", "mentions", "none"]).optional(),
  desktopNotifications: z.enum(["all", "mentions", "none"]).optional(),
  notificationSound: z.boolean().optional(),
  skinTone: z.number().int().min(0).max(5).optional(),
  keywords: z.array(z.string().max(60)).max(20).optional(),
  quietHoursStart: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional(),
  quietHoursEnd: z
    .string()
    .regex(/^\d{2}:\d{2}$/)
    .nullable()
    .optional()
});

export const userRoutes = defineRoutes({
  "PATCH /users/me": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(profileSchema);
    if (input.handle) {
      const [taken] = await db
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.handle, input.handle.toLowerCase()), ne(users.id, user.id)))
        .limit(1);
      if (taken) throw new HttpError(409, "That handle is taken", "handle_taken");
    }
    const [updated] = await db
      .update(users)
      .set({
        ...input,
        handle: input.handle ? input.handle.toLowerCase() : undefined,
        updatedAt: new Date()
      })
      .where(eq(users.id, user.id))
      .returning();
    await broadcastUserUpdate(updated);
    return { user: toSessionUser(updated) };
  },

  "PATCH /users/me/preferences": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(preferencesSchema);
    const merged: UserPreferences = { ...(user.preferences ?? {}), ...input };
    const [updated] = await db
      .update(users)
      .set({ preferences: merged, updatedAt: new Date() })
      .where(eq(users.id, user.id))
      .returning();
    return { user: toSessionUser(updated) };
  },

  "PUT /users/me/status": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(
      z.object({
        emoji: z.string().max(64).nullable().optional(),
        text: z.string().max(140).nullable().optional(),
        expiresAt: z.coerce.date().nullable().optional()
      })
    );
    const updated = await setStatus(user.id, {
      emoji: input.emoji ?? null,
      text: input.text ?? null,
      expiresAt: input.expiresAt ?? null
    });
    return { user: toSessionUser(updated) };
  },

  "PUT /users/me/presence": async (ctx) => {
    const user = await ctx.user();
    const input = await ctx.input(
      z.object({
        presence: z.enum(["active", "away", "dnd", "offline"]),
        dndUntil: z.coerce.date().nullable().optional()
      })
    );
    const updated = await setPresence(user.id, input.presence, input.dndUntil ?? null);
    return { user: toSessionUser(updated) };
  },

  "POST /users/me/heartbeat": async (ctx) => {
    const user = await ctx.user();
    const updated = await heartbeat(user.id, "active");
    return { presence: toPublicUser(updated ?? user).presence };
  },

  "GET /users/:userId": async (ctx) => {
    const viewer = await ctx.user();
    const userId = ctx.param("userId");
    const [target] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!target) throw new HttpError(404, "User not found", "not_found");

    // Profiles are only visible to people who share a workspace.
    const shared = await db
      .select({ workspaceId: workspaceMembers.workspaceId, role: workspaceMembers.role })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, target.id), eq(workspaceMembers.status, "active")));
    const viewerWorkspaces = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.userId, viewer.id), eq(workspaceMembers.status, "active")));
    const viewerSet = new Set(viewerWorkspaces.map((row) => row.workspaceId));
    const overlap = shared.filter((row) => viewerSet.has(row.workspaceId));
    if (overlap.length === 0 && viewer.id !== target.id) {
      throw new HttpError(403, "Profile not available", "profile_forbidden");
    }

    return { user: toPublicUser(target), roles: overlap };
  },

  "GET /workspaces/:workspaceId/directory": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    await requireWorkspaceMember(workspaceId, user.id);
    return workspaceMentionDirectory(workspaceId);
  }
});
