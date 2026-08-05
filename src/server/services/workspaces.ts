import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditEvents,
  channels,
  conversationMembers,
  conversations,
  customEmoji,
  drafts,
  sidebarSections,
  userGroupMembers,
  userGroups,
  users,
  workspaceMembers,
  workspaces
} from "@/db/schema";
import type { User, Workspace } from "@/db/schema";
import { HttpError } from "@/lib/http";
import { slugify } from "@/lib/security";
import type { WorkspaceBootstrap } from "@/shared/types";
import { toPublicUser, toWorkspaceSummary } from "./serializers";
import { listChannelDirectory, listSidebarConversations } from "./conversations";
import { unreadNotificationCount } from "./notifications";

const DEFAULT_CHANNELS = [
  { name: "general", description: "Company-wide announcements and work-based matters", autoJoin: true },
  { name: "random", description: "A place for non-work banter and links", autoJoin: true }
];

export async function createAudit(
  workspaceId: string,
  actorUserId: string | null,
  type: string,
  entityType?: string,
  entityId?: string,
  metadata?: unknown
) {
  await db.insert(auditEvents).values({ workspaceId, actorUserId, type, entityType, entityId, metadata });
}

export async function createWorkspace(options: { name: string; slug?: string; creator: User }) {
  const baseSlug = slugify(options.slug ?? options.name);
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

    const [workspace] = await tx
      .insert(workspaces)
      .values({ name: options.name.trim(), slug, createdByUserId: options.creator.id })
      .returning();

    await tx.insert(workspaceMembers).values({ workspaceId: workspace.id, userId: options.creator.id, role: "owner" });

    const created: Array<{ channelId: string; conversationId: string; name: string }> = [];
    for (const template of DEFAULT_CHANNELS) {
      const [channel] = await tx
        .insert(channels)
        .values({
          workspaceId: workspace.id,
          name: template.name,
          description: template.description,
          visibility: "public",
          autoJoin: template.autoJoin,
          createdByUserId: options.creator.id
        })
        .returning();
      const [conversation] = await tx
        .insert(conversations)
        .values({
          workspaceId: workspace.id,
          type: "channel",
          channelId: channel.id,
          createdByUserId: options.creator.id
        })
        .returning();
      await tx.insert(conversationMembers).values({
        workspaceId: workspace.id,
        conversationId: conversation.id,
        userId: options.creator.id,
        role: "creator",
        lastReadAt: new Date()
      });
      created.push({ channelId: channel.id, conversationId: conversation.id, name: channel.name });
    }

    await tx.insert(auditEvents).values({
      workspaceId: workspace.id,
      actorUserId: options.creator.id,
      type: "workspace.created",
      entityType: "workspace",
      entityId: workspace.id,
      metadata: { channels: created.map((entry) => entry.name) }
    });

    return { workspace, channels: created };
  });
}

/** Everything the client needs for a workspace in one round trip. */
export async function bootstrapWorkspace(workspace: Workspace, user: User): Promise<WorkspaceBootstrap> {
  const [memberRows, channelRows, conversationRows, sectionRows, emojiRows, groupRows, draftRows, unread, role] =
    await Promise.all([
      db
        .select({ member: workspaceMembers, user: users })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(eq(workspaceMembers.workspaceId, workspace.id)),
      db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, user.id)))
        .limit(1)
        .then(([row]) =>
          listChannelDirectory({
            workspaceId: workspace.id,
            userId: user.id,
            membersOnly: row?.role === "guest"
          })
        ),
      listSidebarConversations(workspace.id, user.id),
      db
        .select()
        .from(sidebarSections)
        .where(and(eq(sidebarSections.workspaceId, workspace.id), eq(sidebarSections.userId, user.id)))
        .orderBy(sidebarSections.position),
      db.select().from(customEmoji).where(eq(customEmoji.workspaceId, workspace.id)),
      db
        .select()
        .from(userGroups)
        .where(and(eq(userGroups.workspaceId, workspace.id), isNull(userGroups.deletedAt))),
      db
        .select()
        .from(drafts)
        .where(and(eq(drafts.workspaceId, workspace.id), eq(drafts.userId, user.id))),
      unreadNotificationCount(workspace.id, user.id),
      db
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspace.id), eq(workspaceMembers.userId, user.id)))
        .limit(1)
    ]);

  // Bots hold no workspace membership, so collect them from the conversations
  // they were installed into; without this their messages render as "Unknown".
  const botRows = await db
    .selectDistinct({ user: users })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.workspaceId, workspace.id), eq(users.isBot, true)));

  const groupMemberRows =
    groupRows.length > 0
      ? await db
          .select()
          .from(userGroupMembers)
          .where(inArray(userGroupMembers.groupId, groupRows.map((group) => group.id)))
      : [];

  return {
    workspace: toWorkspaceSummary(workspace),
    role: role[0]?.role ?? "member",
    members: memberRows
      .filter((row) => row.member.status === "active")
      .map((row) => ({
        memberId: row.member.id,
        role: row.member.role,
        status: row.member.status,
        user: toPublicUser(row.user)
      })),
    bots: botRows.map((row) => toPublicUser(row.user)),
    channels: channelRows,
    conversations: conversationRows,
    sections: sectionRows.map((section) => ({
      id: section.id,
      name: section.name,
      emoji: section.emoji,
      position: section.position,
      collapsed: section.collapsed
    })),
    emoji: emojiRows.map((emoji) => ({
      id: emoji.id,
      name: emoji.name,
      imageUrl: emoji.imageUrl,
      createdByUserId: emoji.createdByUserId,
      createdAt: new Date(emoji.createdAt).toISOString()
    })),
    groups: groupRows.map((group) => ({
      id: group.id,
      handle: group.handle,
      name: group.name,
      description: group.description,
      memberIds: groupMemberRows.filter((row) => row.groupId === group.id).map((row) => row.userId)
    })),
    drafts: draftRows.map((draft) => ({
      id: draft.id,
      conversationId: draft.conversationId,
      parentMessageId: draft.parentMessageId,
      bodyText: draft.bodyText,
      updatedAt: new Date(draft.updatedAt).toISOString()
    })),
    unreadNotifications: unread
  };
}
