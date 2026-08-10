import type { UserPreferences } from "@/db/schema";

export type PresenceState = "active" | "away" | "dnd" | "offline";
export type WorkspaceRoleName = "owner" | "admin" | "member" | "guest";
export type NotificationLevelName = "all" | "mentions" | "none";

export type PublicUser = {
  id: string;
  displayName: string;
  handle: string | null;
  email: string;
  avatarUrl: string | null;
  avatarColor: string | null;
  title: string | null;
  pronouns: string | null;
  timezone: string;
  statusEmoji: string | null;
  statusText: string | null;
  statusExpiresAt: string | null;
  presence: PresenceState;
  dndUntil: string | null;
  isBot: boolean;
};

export type SessionUser = PublicUser & {
  emailVerifiedAt: string | null;
  preferences: UserPreferences | null;
  phone: string | null;
};

export type WorkspaceSummary = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconEmoji: string | null;
  logoUrl: string | null;
  plan: string;
  seatLimit: number;
  subscriptionStatus: string;
  readOnlyAt: string | null;
  membersCanInvite: boolean;
  membersCanCreateChannels: boolean;
  retentionDays: number | null;
};

export type WorkspaceUsage = {
  activeMembers: number;
  pendingInvites: number;
  fileCount: number;
  storageBytes: number;
  /** Resolved ceiling: the workspace override or the deployment default. null means unlimited. */
  storageLimitBytes: number | null;
};

export type WorkspaceMembership = {
  workspace: WorkspaceSummary;
  role: WorkspaceRoleName;
  memberId: string;
};

export type ChannelSummary = {
  id: string;
  name: string;
  topic: string | null;
  description: string | null;
  visibility: "public" | "private";
  autoJoin: boolean;
  postingPolicy: "everyone" | "admins";
  retentionDays: number | null;
  archivedAt: string | null;
  createdByUserId: string;
  createdAt: string;
  memberCount?: number;
};

export type ConversationSummary = {
  id: string;
  workspaceId: string;
  type: "channel" | "dm" | "group_dm";
  channelId: string | null;
  name: string | null;
  lastMessageAt: string | null;
  channel: ChannelSummary | null;
  memberIds: string[];
  membership: {
    joined: boolean;
    starred: boolean;
    muted: boolean;
    hidden: boolean;
    notificationLevel: NotificationLevelName;
    sectionId: string | null;
    lastReadAt: string | null;
    lastReadMessageId: string | null;
  } | null;
  unreadCount: number;
  mentionCount: number;
};

export type ReactionSummary = {
  emoji: string;
  count: number;
  users: Array<{ id: string; displayName: string }>;
  reacted: boolean;
};

export type FileSummary = {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  width: number | null;
  height: number | null;
  url: string;
  uploaderId: string;
  createdAt: string;
};

export type LinkPreviewSummary = {
  url: string;
  title: string | null;
  description: string | null;
  imageUrl: string | null;
  siteName: string | null;
};

export type ThreadSummary = {
  replyCount: number;
  lastReplyAt: string | null;
  participantIds: string[];
  /** Whether the viewer gets notified about new replies. */
  following: boolean;
};

export type MessageDto = {
  id: string;
  workspaceId: string;
  conversationId: string;
  senderId: string;
  parentMessageId: string | null;
  clientMessageId: string | null;
  type: "user" | "system" | "join" | "leave" | "topic" | "purpose" | "rename" | "archive" | "pin";
  bodyText: string;
  metadata: Record<string, unknown> | null;
  threadBroadcast: boolean;
  editedAt: string | null;
  deletedAt: string | null;
  createdAt: string;
  reactions: ReactionSummary[];
  files: FileSummary[];
  links: LinkPreviewSummary[];
  thread: ThreadSummary;
  pinned: boolean;
  saved: boolean;
};

export type NotificationDto = {
  id: string;
  type: string;
  workspaceId: string;
  actorUserId: string | null;
  conversationId: string | null;
  messageId: string | null;
  body: string | null;
  readAt: string | null;
  createdAt: string;
};

export type SidebarSectionDto = {
  id: string;
  name: string;
  emoji: string | null;
  position: number;
  collapsed: boolean;
};

export type CustomEmojiDto = {
  id: string;
  name: string;
  imageUrl: string;
  createdByUserId: string;
  createdAt: string;
};

export type UserGroupDto = {
  id: string;
  handle: string;
  name: string;
  description: string | null;
  memberIds: string[];
};

export type DraftDto = {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  bodyText: string;
  updatedAt: string;
};

export type ScheduledMessageDto = {
  id: string;
  conversationId: string;
  parentMessageId: string | null;
  bodyText: string;
  sendAt: string;
  status: "pending" | "sent" | "canceled" | "failed";
};

export type ReminderDto = {
  id: string;
  text: string;
  remindAt: string;
  conversationId: string | null;
  messageId: string | null;
  completedAt: string | null;
  firedAt: string | null;
};

export type BookmarkDto = {
  id: string;
  channelId: string;
  title: string;
  url: string;
  emoji: string | null;
  position: number;
};

/** Everything the client needs to render a workspace in a single request. */
export type DirectoryChannel = ChannelSummary & { conversationId: string; joined: boolean };

export type WorkspaceBootstrap = {
  workspace: WorkspaceSummary;
  role: WorkspaceRoleName;
  members: Array<{ memberId: string; role: WorkspaceRoleName; status: string; user: PublicUser }>;
  /** Webhook/app identities that post into conversations but hold no seat. */
  bots: PublicUser[];
  channels: DirectoryChannel[];
  conversations: ConversationSummary[];
  sections: SidebarSectionDto[];
  emoji: CustomEmojiDto[];
  groups: UserGroupDto[];
  drafts: DraftDto[];
  unreadNotifications: number;
};

export type RealtimeEvent =
  | { type: "message.created"; conversationId: string; message: MessageDto }
  | { type: "message.updated"; conversationId: string; message: MessageDto }
  | { type: "message.deleted"; conversationId: string; messageId: string; parentMessageId: string | null }
  | { type: "reaction.changed"; conversationId: string; messageId: string; reactions: ReactionSummary[] }
  | { type: "conversation.read"; conversationId: string; userId: string; lastReadAt: string }
  | { type: "conversation.updated"; conversationId: string }
  | { type: "typing"; conversationId: string; userId: string; parentMessageId: string | null }
  | { type: "presence"; userId: string; presence: PresenceState }
  | { type: "user.updated"; user: PublicUser }
  | { type: "channel.created"; channelId: string }
  | { type: "channel.updated"; channelId: string }
  | { type: "member.changed"; userId: string }
  | { type: "notification.created"; notification: NotificationDto }
  | { type: "pin.changed"; conversationId: string };
