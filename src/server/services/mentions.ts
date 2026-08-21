import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { conversationMembers, userGroupMembers, userGroups, users, workspaceMembers } from "@/db/schema";
import { effectivePresence } from "./serializers";

export type MentionTargets = {
  userIds: string[];
  handles: string[];
  groupIds: string[];
  broadcasts: Array<"here" | "channel" | "everyone">;
  channelIds: string[];
};

/** Extracts mention tokens without touching the database. */
export function parseMentions(bodyText: string): MentionTargets {
  const userIds = new Set<string>();
  const handles = new Set<string>();
  const groupIds = new Set<string>();
  const broadcasts = new Set<"here" | "channel" | "everyone">();
  const channelIds = new Set<string>();

  const stripped = bodyText.replace(/```[\s\S]*?```/g, " ").replace(/`[^`\n]*`/g, " ");

  for (const match of stripped.matchAll(/<@([0-9a-f-]{36})>/gi)) userIds.add(match[1].toLowerCase());
  for (const match of stripped.matchAll(/<!group:([0-9a-f-]{36})\|/gi)) groupIds.add(match[1].toLowerCase());
  for (const match of stripped.matchAll(/<#([0-9a-f-]{36})\|/gi)) channelIds.add(match[1].toLowerCase());
  for (const match of stripped.matchAll(/<!(here|channel|everyone)>/gi)) {
    broadcasts.add(match[1].toLowerCase() as "here" | "channel" | "everyone");
  }
  for (const match of stripped.matchAll(/(^|[\s(])@([a-z0-9._-]{1,64})/gi)) {
    const handle = match[2].toLowerCase();
    if (handle === "here" || handle === "channel" || handle === "everyone") {
      broadcasts.add(handle);
      continue;
    }
    handles.add(handle);
  }

  return {
    userIds: [...userIds],
    handles: [...handles],
    groupIds: [...groupIds],
    broadcasts: [...broadcasts],
    channelIds: [...channelIds]
  };
}

/**
 * Resolves mention tokens to the members of a conversation who should be
 * notified. Mentions never reach people who cannot see the conversation.
 */
export async function resolveMentionedUserIds(options: {
  workspaceId: string;
  conversationId: string;
  senderId: string;
  bodyText: string;
}): Promise<{ userIds: string[]; broadcast: boolean }> {
  const targets = parseMentions(options.bodyText);
  if (
    targets.userIds.length === 0 &&
    targets.handles.length === 0 &&
    targets.groupIds.length === 0 &&
    targets.broadcasts.length === 0
  ) {
    return { userIds: [], broadcast: false };
  }

  const members = await db
    .select({
      userId: users.id,
      handle: users.handle,
      displayName: users.displayName,
      email: users.email,
      presence: users.presence,
      lastActiveAt: users.lastActiveAt,
      dndUntil: users.dndUntil
    })
    .from(conversationMembers)
    .innerJoin(users, eq(users.id, conversationMembers.userId))
    .where(and(eq(conversationMembers.conversationId, options.conversationId), isNull(conversationMembers.leftAt)));

  const matched = new Set<string>();
  const broadcast = targets.broadcasts.length > 0;

  // `@channel`/`@everyone` reach every member; `@here` is explicitly only the
  // people who are around right now, which is what the composer hint promises.
  const reachesEveryone = targets.broadcasts.some((entry) => entry !== "here");
  if (reachesEveryone) {
    for (const member of members) matched.add(member.userId);
  } else if (targets.broadcasts.includes("here")) {
    for (const member of members) {
      if (effectivePresence(member) === "active") matched.add(member.userId);
    }
  }

  const directIds = new Set(targets.userIds);
  const handleSet = new Set(targets.handles);
  for (const member of members) {
    if (directIds.has(member.userId.toLowerCase())) matched.add(member.userId);
    const candidates = [
      member.handle?.toLowerCase(),
      member.email.split("@")[0]?.toLowerCase(),
      member.displayName.toLowerCase().replace(/\s+/g, ".")
    ].filter(Boolean) as string[];
    if (candidates.some((candidate) => handleSet.has(candidate))) matched.add(member.userId);
  }

  if (targets.groupIds.length > 0) {
    const groupUsers = await db
      .select({ userId: userGroupMembers.userId })
      .from(userGroupMembers)
      .innerJoin(userGroups, eq(userGroups.id, userGroupMembers.groupId))
      .where(and(inArray(userGroupMembers.groupId, targets.groupIds), eq(userGroups.workspaceId, options.workspaceId)));
    const memberIds = new Set(members.map((member) => member.userId));
    for (const row of groupUsers) if (memberIds.has(row.userId)) matched.add(row.userId);
  }

  matched.delete(options.senderId);
  return { userIds: [...matched], broadcast };
}

/** Directory used by the composer's @-autocomplete. */
export async function workspaceMentionDirectory(workspaceId: string) {
  const [people, groups] = await Promise.all([
    db
      .select({
        id: users.id,
        displayName: users.displayName,
        handle: users.handle,
        avatarUrl: users.avatarUrl,
        title: users.title
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(workspaceMembers.status, "active"))),
    db
      .select({ id: userGroups.id, handle: userGroups.handle, name: userGroups.name })
      .from(userGroups)
      .where(and(eq(userGroups.workspaceId, workspaceId), isNull(userGroups.deletedAt)))
  ]);
  return { people, groups };
}

export function mentionedInBody(bodyText: string, userId: string, handles: string[]) {
  const targets = parseMentions(bodyText);
  if (targets.userIds.includes(userId.toLowerCase())) return true;
  if (targets.broadcasts.length > 0) return true;
  const lowered = handles.map((handle) => handle.toLowerCase());
  return targets.handles.some((handle) => lowered.includes(handle));
}

/**
 * Display names for every `<@id>` in a body so `toPlainText` can render
 * "@Ada Lovelace" instead of its "@someone" fallback. Returns undefined when
 * there is nothing to resolve, which is the shape `toPlainText` expects.
 */
export async function mentionNameResolver(bodyText: string) {
  const ids = parseMentions(bodyText).userIds;
  if (ids.length === 0) return undefined;
  const rows = await db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(inArray(users.id, ids));
  const nameById = new Map(rows.map((row) => [row.id, row.displayName]));
  return { user: (id: string) => nameById.get(id) };
}
