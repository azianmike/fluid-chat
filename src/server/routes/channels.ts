import { and, eq, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { channelBookmarks, channels, conversationMembers, conversations } from "@/db/schema";
import type { Channel, Conversation } from "@/db/schema";
import { requireWorkspaceWritable } from "@/lib/billing";
import { HttpError, json } from "@/lib/http";
import {
  isModerator,
  requireConversationMember,
  requireWorkspaceMember,
  resolveConversationAccess
} from "@/lib/permissions";
import { toWorkspace } from "@/lib/realtime";
import { normalizeChannelName } from "@/lib/security";
import { defineRoutes } from "../router";
import {
  addChannelMembers,
  conversationMemberList,
  createChannel,
  joinChannel,
  leaveChannel,
  listChannelDirectory
} from "../services/conversations";
import { postSystemMessage } from "../services/messages";
import { toChannelSummary, toPublicUser } from "../services/serializers";
import { createAudit } from "../services/workspaces";

async function loadChannel(channelId: string): Promise<{ channel: Channel; conversation: Conversation }> {
  const [row] = await db
    .select({ channel: channels, conversation: conversations })
    .from(channels)
    .innerJoin(conversations, eq(conversations.channelId, channels.id))
    .where(eq(channels.id, channelId))
    .limit(1);
  if (!row) throw new HttpError(404, "Channel not found", "not_found");
  return row;
}

export const channelRoutes = defineRoutes({
  "GET /workspaces/:workspaceId/channels": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    const member = await requireWorkspaceMember(workspaceId, user.id);
    return {
      channels: await listChannelDirectory({
        workspaceId,
        userId: user.id,
        includeArchived: ctx.queryFlag("includeArchived"),
        query: ctx.query("q"),
        membersOnly: member.role === "guest"
      })
    };
  },

  "POST /workspaces/:workspaceId/channels": async (ctx) => {
    const user = await ctx.user();
    const workspaceId = ctx.param("workspaceId");
    const input = await ctx.input(
      z.object({
        name: z.string().min(1).max(80),
        visibility: z.enum(["public", "private"]).default("public"),
        description: z.string().max(500).optional(),
        topic: z.string().max(250).optional(),
        memberIds: z.array(z.string().uuid()).max(500).optional()
      })
    );
    const result = await createChannel({
      workspaceId,
      actor: user,
      name: input.name,
      visibility: input.visibility,
      description: input.description,
      topic: input.topic,
      memberIds: input.memberIds
    });
    await createAudit(workspaceId, user.id, "channel.created", "channel", result.channel.id);
    return json(
      { channel: toChannelSummary(result.channel, result.memberIds.length), conversationId: result.conversation.id },
      201
    );
  },

  "GET /channels/:channelId": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    const access = await resolveConversationAccess(conversation.id, user.id);
    const members = await conversationMemberList(conversation.id);
    return {
      channel: toChannelSummary(channel, members.length),
      conversationId: conversation.id,
      joined: !!access.membership && !access.membership.leftAt,
      members: members.map((row) => toPublicUser(row.user))
    };
  },

  "PATCH /channels/:channelId": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    const member = await requireWorkspaceMember(channel.workspaceId, user.id);
    await requireWorkspaceWritable(channel.workspaceId);
    const input = await ctx.input(
      z.object({
        name: z.string().min(1).max(80).optional(),
        topic: z.string().max(250).nullable().optional(),
        description: z.string().max(500).nullable().optional(),
        postingPolicy: z.enum(["everyone", "admins"]).optional(),
        visibility: z.enum(["private"]).optional(),
        retentionDays: z.number().int().min(1).max(3650).nullable().optional(),
        autoJoin: z.boolean().optional()
      })
    );

    const privileged = isModerator(member) || channel.createdByUserId === user.id;
    const restrictedChange =
      input.name !== undefined ||
      input.postingPolicy !== undefined ||
      input.visibility !== undefined ||
      input.retentionDays !== undefined ||
      input.autoJoin !== undefined;
    if (restrictedChange && !privileged) {
      throw new HttpError(403, "Only admins or the channel creator can change these settings", "admin_required");
    }
    if (!restrictedChange) await requireConversationMember(conversation.id, user.id);

    const update: Partial<Channel> & { updatedAt: Date } = { updatedAt: new Date() };
    if (input.name !== undefined) {
      const name = normalizeChannelName(input.name);
      if (!name) throw new HttpError(400, "Invalid channel name", "invalid_channel_name");
      const [existing] = await db
        .select({ id: channels.id })
        .from(channels)
        .where(and(eq(channels.workspaceId, channel.workspaceId), eq(channels.name, name), ne(channels.id, channel.id)))
        .limit(1);
      if (existing) throw new HttpError(409, "Channel name already exists", "duplicate_channel_name");
      update.name = name;
    }
    if (input.topic !== undefined) update.topic = input.topic;
    if (input.description !== undefined) update.description = input.description;
    if (input.postingPolicy !== undefined) update.postingPolicy = input.postingPolicy;
    if (input.retentionDays !== undefined) update.retentionDays = input.retentionDays;
    if (input.autoJoin !== undefined) update.autoJoin = input.autoJoin;
    if (input.visibility === "private") update.visibility = "private";

    const [updated] = await db.update(channels).set(update).where(eq(channels.id, channel.id)).returning();

    if (input.topic !== undefined && input.topic !== channel.topic) {
      await postSystemMessage({
        conversation,
        actor: user,
        type: "topic",
        bodyText: input.topic
          ? `<@${user.id}> set the channel topic: ${input.topic}`
          : `<@${user.id}> cleared the channel topic.`
      });
    }
    if (update.name && update.name !== channel.name) {
      await postSystemMessage({
        conversation,
        actor: user,
        type: "rename",
        bodyText: `<@${user.id}> renamed the channel to #${update.name}`
      });
    }

    await createAudit(channel.workspaceId, user.id, "channel.updated", "channel", channel.id, input);
    await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
    return { channel: toChannelSummary(updated) };
  },

  "POST /channels/:channelId/join": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    const member = await requireWorkspaceMember(channel.workspaceId, user.id);
    // Guests are added to channels by members; they cannot join on their own.
    if (member.role === "guest") {
      throw new HttpError(403, "Ask a member to add you to this channel", "guest_join_forbidden");
    }
    await joinChannel(channel, conversation, user);
    return { ok: true, conversationId: conversation.id };
  },

  "POST /channels/:channelId/leave": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    await requireConversationMember(conversation.id, user.id);
    await leaveChannel(channel, conversation, user);
    return { ok: true };
  },

  "POST /channels/:channelId/archive": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    const member = await requireWorkspaceMember(channel.workspaceId, user.id);
    if (!isModerator(member) && channel.createdByUserId !== user.id) {
      throw new HttpError(403, "Only admins or the channel creator can archive this channel", "admin_required");
    }
    if (channel.name === "general") throw new HttpError(400, "#general cannot be archived", "required_channel");
    await db.update(channels).set({ archivedAt: new Date(), updatedAt: new Date() }).where(eq(channels.id, channel.id));
    await postSystemMessage({
      conversation,
      actor: user,
      type: "archive",
      bodyText: `<@${user.id}> archived this channel.`
    });
    await createAudit(channel.workspaceId, user.id, "channel.archived", "channel", channel.id);
    await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
    return { ok: true };
  },

  "POST /channels/:channelId/unarchive": async (ctx) => {
    const user = await ctx.user();
    const { channel } = await loadChannel(ctx.param("channelId"));
    const member = await requireWorkspaceMember(channel.workspaceId, user.id);
    if (!isModerator(member)) throw new HttpError(403, "Admin access required", "admin_required");
    await db.update(channels).set({ archivedAt: null, updatedAt: new Date() }).where(eq(channels.id, channel.id));
    await createAudit(channel.workspaceId, user.id, "channel.unarchived", "channel", channel.id);
    await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
    return { ok: true };
  },

  "GET /channels/:channelId/members": async (ctx) => {
    const user = await ctx.user();
    const { conversation } = await loadChannel(ctx.param("channelId"));
    await resolveConversationAccess(conversation.id, user.id);
    const members = await conversationMemberList(conversation.id);
    return { members: members.map((row) => ({ ...toPublicUser(row.user), joinedAt: row.member.joinedAt })) };
  },

  "POST /channels/:channelId/members": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    await requireConversationMember(conversation.id, user.id);
    await requireWorkspaceWritable(channel.workspaceId);
    const input = await ctx.input(z.object({ userIds: z.array(z.string().uuid()).min(1).max(100) }));
    const added = await addChannelMembers({ channel, conversation, actor: user, userIds: input.userIds });
    return { added };
  },

  "DELETE /channels/:channelId/members/:userId": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    const targetId = ctx.param("userId");
    const member = await requireWorkspaceMember(channel.workspaceId, user.id);
    if (targetId !== user.id && !isModerator(member) && channel.createdByUserId !== user.id) {
      throw new HttpError(403, "Only admins can remove other people", "admin_required");
    }
    await db
      .update(conversationMembers)
      .set({ leftAt: new Date() })
      .where(and(eq(conversationMembers.conversationId, conversation.id), eq(conversationMembers.userId, targetId)));
    await postSystemMessage({
      conversation,
      actor: user,
      type: "leave",
      bodyText:
        targetId === user.id
          ? `<@${user.id}> left the channel.`
          : `<@${user.id}> removed <@${targetId}> from the channel.`
    });
    return { ok: true };
  },

  /* -------------------------------------------------------------- bookmarks */

  "GET /channels/:channelId/bookmarks": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    await resolveConversationAccess(conversation.id, user.id);
    const rows = await db
      .select()
      .from(channelBookmarks)
      .where(eq(channelBookmarks.channelId, channel.id))
      .orderBy(channelBookmarks.position);
    return { bookmarks: rows };
  },

  "POST /channels/:channelId/bookmarks": async (ctx) => {
    const user = await ctx.user();
    const { channel, conversation } = await loadChannel(ctx.param("channelId"));
    await requireConversationMember(conversation.id, user.id);
    const input = await ctx.input(
      z.object({
        title: z.string().min(1).max(120),
        url: z.string().url().max(1000),
        emoji: z.string().max(64).optional()
      })
    );
    const [bookmark] = await db
      .insert(channelBookmarks)
      .values({
        workspaceId: channel.workspaceId,
        channelId: channel.id,
        title: input.title,
        url: input.url,
        emoji: input.emoji ?? null,
        createdByUserId: user.id,
        position: Date.now() % 100000
      })
      .returning();
    await toWorkspace(channel.workspaceId, { type: "channel.updated", channelId: channel.id });
    return json({ bookmark }, 201);
  },

  "DELETE /bookmarks/:bookmarkId": async (ctx) => {
    const user = await ctx.user();
    const bookmarkId = ctx.param("bookmarkId");
    const [bookmark] = await db.select().from(channelBookmarks).where(eq(channelBookmarks.id, bookmarkId)).limit(1);
    if (!bookmark) throw new HttpError(404, "Bookmark not found", "not_found");
    await requireWorkspaceMember(bookmark.workspaceId, user.id);
    await db.delete(channelBookmarks).where(eq(channelBookmarks.id, bookmark.id));
    await toWorkspace(bookmark.workspaceId, { type: "channel.updated", channelId: bookmark.channelId });
    return { ok: true };
  }
});
