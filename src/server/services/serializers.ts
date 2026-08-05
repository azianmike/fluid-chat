import type {
  Channel,
  Conversation,
  ConversationMember,
  FileRecord,
  NotificationRecord,
  User,
  Workspace
} from "@/db/schema";
import type {
  ChannelSummary,
  ConversationSummary,
  FileSummary,
  NotificationDto,
  PresenceState,
  PublicUser,
  SessionUser,
  WorkspaceSummary
} from "@/shared/types";

const iso = (value: Date | string | null | undefined) =>
  value ? (value instanceof Date ? value.toISOString() : new Date(value).toISOString()) : null;

const AVATAR_COLORS = [
  "#4a154b",
  "#1264a3",
  "#2eb67d",
  "#e01e5a",
  "#ecb22e",
  "#7c3aed",
  "#0f766e",
  "#b45309",
  "#be123c",
  "#0369a1"
];

/** Stable per-user fallback avatar color so people keep the same swatch. */
export function avatarColorFor(userId: string) {
  let hash = 0;
  for (let index = 0; index < userId.length; index += 1) {
    hash = (hash * 31 + userId.charCodeAt(index)) % 100_000;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}

/** Presence decays to `away` when the heartbeat is stale, and honors DND. */
export function effectivePresence(user: Pick<User, "presence" | "lastActiveAt" | "dndUntil">): PresenceState {
  const now = Date.now();
  if (user.dndUntil && new Date(user.dndUntil).getTime() > now) return "dnd";
  if (user.presence === "offline") return "offline";
  if (!user.lastActiveAt) return user.presence;
  const idleMs = now - new Date(user.lastActiveAt).getTime();
  if (idleMs > 5 * 60_000) return "offline";
  if (idleMs > 60_000 && user.presence === "active") return "away";
  return user.presence;
}

export function toPublicUser(user: User): PublicUser {
  const statusExpired = user.statusExpiresAt ? new Date(user.statusExpiresAt).getTime() < Date.now() : false;
  return {
    id: user.id,
    displayName: user.displayName,
    handle: user.handle,
    email: user.email,
    avatarUrl: user.avatarUrl,
    avatarColor: user.avatarColor ?? avatarColorFor(user.id),
    title: user.title,
    pronouns: user.pronouns,
    timezone: user.timezone,
    statusEmoji: statusExpired ? null : user.statusEmoji,
    statusText: statusExpired ? null : user.statusText,
    statusExpiresAt: iso(user.statusExpiresAt),
    presence: effectivePresence(user),
    dndUntil: iso(user.dndUntil),
    isBot: user.isBot
  };
}

export function toSessionUser(user: User): SessionUser {
  return {
    ...toPublicUser(user),
    emailVerifiedAt: iso(user.emailVerifiedAt),
    preferences: user.preferences ?? null,
    phone: user.phone
  };
}

export function toWorkspaceSummary(workspace: Workspace): WorkspaceSummary {
  return {
    id: workspace.id,
    name: workspace.name,
    slug: workspace.slug,
    description: workspace.description,
    iconEmoji: workspace.iconEmoji,
    logoUrl: workspace.logoUrl,
    plan: workspace.plan,
    seatLimit: workspace.seatLimit,
    subscriptionStatus: workspace.subscriptionStatus,
    readOnlyAt: iso(workspace.readOnlyAt),
    membersCanInvite: workspace.membersCanInvite,
    membersCanCreateChannels: workspace.membersCanCreateChannels,
    retentionDays: workspace.retentionDays
  };
}

export function toChannelSummary(channel: Channel, memberCount?: number): ChannelSummary {
  return {
    id: channel.id,
    name: channel.name,
    topic: channel.topic,
    description: channel.description,
    visibility: channel.visibility,
    autoJoin: channel.autoJoin,
    postingPolicy: channel.postingPolicy,
    retentionDays: channel.retentionDays,
    archivedAt: iso(channel.archivedAt),
    createdByUserId: channel.createdByUserId,
    createdAt: new Date(channel.createdAt).toISOString(),
    memberCount
  };
}

export function toConversationSummary(input: {
  conversation: Conversation;
  channel?: Channel | null;
  membership?: ConversationMember | null;
  memberIds?: string[];
  unreadCount?: number;
  mentionCount?: number;
  memberCount?: number;
}): ConversationSummary {
  const { conversation, channel, membership } = input;
  return {
    id: conversation.id,
    workspaceId: conversation.workspaceId,
    type: conversation.type,
    channelId: conversation.channelId,
    name: conversation.name,
    lastMessageAt: iso(conversation.lastMessageAt),
    channel: channel ? toChannelSummary(channel, input.memberCount) : null,
    memberIds: input.memberIds ?? [],
    membership: membership
      ? {
          joined: !membership.leftAt,
          starred: membership.starred,
          muted: !!membership.mutedAt,
          hidden: !!membership.hiddenAt,
          notificationLevel: membership.notificationLevel,
          sectionId: membership.sectionId,
          lastReadAt: iso(membership.lastReadAt),
          lastReadMessageId: membership.lastReadMessageId
        }
      : null,
    unreadCount: input.unreadCount ?? 0,
    mentionCount: input.mentionCount ?? 0
  };
}

export function fileUrl(fileId: string) {
  return `/api/files/${fileId}/download`;
}

export function toFileSummary(file: FileRecord): FileSummary {
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    size: file.size,
    width: file.width,
    height: file.height,
    url: fileUrl(file.id),
    uploaderId: file.uploaderId,
    createdAt: new Date(file.createdAt).toISOString()
  };
}

export function toNotificationDto(notification: NotificationRecord): NotificationDto {
  return {
    id: notification.id,
    type: notification.type,
    workspaceId: notification.workspaceId,
    actorUserId: notification.actorUserId,
    conversationId: notification.conversationId,
    messageId: notification.messageId,
    body: notification.body,
    readAt: iso(notification.readAt),
    createdAt: new Date(notification.createdAt).toISOString()
  };
}

export { iso as toIso };
