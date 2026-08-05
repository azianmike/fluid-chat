import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/* -------------------------------------------------------------------------- */
/* Enums                                                                       */
/* -------------------------------------------------------------------------- */

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member", "guest"]);
export const memberStatus = pgEnum("member_status", ["active", "removed", "suspended"]);
export const inviteType = pgEnum("invite_type", ["email", "link"]);
export const channelVisibility = pgEnum("channel_visibility", ["public", "private"]);
export const conversationType = pgEnum("conversation_type", ["channel", "dm", "group_dm"]);
export const exportStatus = pgEnum("export_status", ["queued", "processing", "ready", "failed", "expired"]);
export const messageType = pgEnum("message_type", ["user", "system", "join", "leave", "topic", "purpose", "rename", "archive", "pin"]);
export const notificationLevel = pgEnum("notification_level", ["all", "mentions", "none"]);
export const presenceStatus = pgEnum("presence_status", ["active", "away", "dnd", "offline"]);
export const postingPolicy = pgEnum("posting_policy", ["everyone", "admins"]);
export const scheduledStatus = pgEnum("scheduled_status", ["pending", "sent", "canceled", "failed"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  }
});

/* -------------------------------------------------------------------------- */
/* Identity                                                                    */
/* -------------------------------------------------------------------------- */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  handle: text("handle"),
  avatarUrl: text("avatar_url"),
  avatarColor: text("avatar_color"),
  title: text("title"),
  pronouns: text("pronouns"),
  phone: text("phone"),
  timezone: text("timezone").notNull().default("UTC"),
  statusEmoji: text("status_emoji"),
  statusText: text("status_text"),
  statusExpiresAt: timestamp("status_expires_at", { withTimezone: true }),
  presence: presenceStatus("presence").notNull().default("offline"),
  dndUntil: timestamp("dnd_until", { withTimezone: true }),
  lastActiveAt: timestamp("last_active_at", { withTimezone: true }),
  preferences: jsonb("preferences").$type<UserPreferences>(),
  isBot: boolean("is_bot").notNull().default(false),
  ...timestamps
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  userAgent: text("user_agent"),
  ipAddress: text("ip_address"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

/* -------------------------------------------------------------------------- */
/* Workspaces                                                                  */
/* -------------------------------------------------------------------------- */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  description: text("description"),
  logoUrl: text("logo_url"),
  iconEmoji: text("icon_emoji"),
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  seatLimit: integer("seat_limit").notNull().default(5),
  overageAllowed: boolean("overage_allowed").notNull().default(false),
  gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
  readOnlyAt: timestamp("read_only_at", { withTimezone: true }),
  retentionDays: integer("retention_days"),
  membersCanInvite: boolean("members_can_invite").notNull().default(true),
  membersCanCreateChannels: boolean("members_can_create_channels").notNull().default(true),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
});

export const workspaceMembers = pgTable("workspace_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: workspaceRole("role").notNull(),
  status: memberStatus("status").notNull().default("active"),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  removedAt: timestamp("removed_at", { withTimezone: true }),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.workspaceId, table.userId),
  index("workspace_members_workspace_user_idx").on(table.workspaceId, table.userId)
]);

export const workspaceInvites = pgTable("workspace_invites", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  email: text("email"),
  role: workspaceRole("role").notNull().default("member"),
  tokenHash: text("token_hash").notNull().unique(),
  inviteType: inviteType("invite_type").notNull().default("email"),
  invitedByUserId: uuid("invited_by_user_id").notNull().references(() => users.id),
  maxUses: integer("max_uses"),
  useCount: integer("use_count").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("workspace_invites_workspace_email_idx").on(table.workspaceId, table.email)
]);

export const userGroups = pgTable("user_groups", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  handle: text("handle").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  unique().on(table.workspaceId, table.handle)
]);

export const userGroupMembers = pgTable("user_group_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  groupId: uuid("group_id").notNull().references(() => userGroups.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.groupId, table.userId)
]);

/* -------------------------------------------------------------------------- */
/* Channels and conversations                                                  */
/* -------------------------------------------------------------------------- */

export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  topic: text("topic"),
  visibility: channelVisibility("visibility").notNull().default("public"),
  autoJoin: boolean("auto_join").notNull().default(false),
  postingPolicy: postingPolicy("posting_policy").notNull().default("everyone"),
  retentionDays: integer("retention_days"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  unique().on(table.workspaceId, table.name)
]);

export const channelBookmarks = pgTable("channel_bookmarks", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  channelId: uuid("channel_id").notNull().references(() => channels.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  emoji: text("emoji"),
  position: integer("position").notNull().default(0),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("channel_bookmarks_channel_idx").on(table.channelId)
]);

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  type: conversationType("type").notNull(),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  name: text("name"),
  memberKey: text("member_key"),
  createdByUserId: uuid("created_by_user_id").references(() => users.id),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  ...timestamps
}, (table) => [
  index("conversations_workspace_idx").on(table.workspaceId),
  unique().on(table.workspaceId, table.memberKey)
]);

export const sidebarSections = pgTable("sidebar_sections", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  emoji: text("emoji"),
  position: integer("position").notNull().default(0),
  collapsed: boolean("collapsed").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("sidebar_sections_user_idx").on(table.workspaceId, table.userId)
]);

export const conversationMembers = pgTable("conversation_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  lastReadMessageId: uuid("last_read_message_id"),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  mutedAt: timestamp("muted_at", { withTimezone: true }),
  notificationLevel: notificationLevel("notification_level").notNull().default("all"),
  starred: boolean("starred").notNull().default(false),
  sectionId: uuid("section_id").references(() => sidebarSections.id, { onDelete: "set null" }),
  hiddenAt: timestamp("hidden_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true })
}, (table) => [
  unique().on(table.conversationId, table.userId),
  index("conversation_members_user_idx").on(table.workspaceId, table.userId)
]);

/* -------------------------------------------------------------------------- */
/* Messages                                                                    */
/* -------------------------------------------------------------------------- */

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  parentMessageId: uuid("parent_message_id"),
  clientMessageId: text("client_message_id"),
  type: messageType("type").notNull().default("user"),
  bodyText: text("body_text").notNull(),
  bodyJson: jsonb("body_json"),
  metadata: jsonb("metadata"),
  threadBroadcast: boolean("thread_broadcast").notNull().default(false),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  searchVector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(body_text, ''))`)
}, (table) => [
  unique().on(table.senderId, table.clientMessageId),
  index("messages_conversation_idx").on(table.conversationId, table.createdAt),
  index("messages_workspace_idx").on(table.workspaceId),
  index("messages_parent_idx").on(table.parentMessageId),
  index("messages_search_idx").using("gin", table.searchVector)
]);

export const messageReactions = pgTable("message_reactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.messageId, table.userId, table.emoji),
  index("message_reactions_message_idx").on(table.messageId)
]);

export const messagePins = pgTable("message_pins", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  pinnedByUserId: uuid("pinned_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.conversationId, table.messageId),
  index("message_pins_conversation_idx").on(table.conversationId)
]);

export const threadSubscriptions = pgTable("thread_subscriptions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  rootMessageId: uuid("root_message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  /** `following` opts in explicitly, `muted` opts out of the automatic follow. */
  state: text("state").notNull().default("following"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.userId, table.rootMessageId),
  index("thread_subscriptions_root_idx").on(table.rootMessageId)
]);

export const webhooks = pgTable("webhooks", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  tokenHash: text("token_hash").notNull().unique(),
  botUserId: uuid("bot_user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("webhooks_conversation_idx").on(table.conversationId)
]);

export const savedItems = pgTable("saved_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.userId, table.messageId),
  index("saved_items_user_idx").on(table.workspaceId, table.userId)
]);

export const drafts = pgTable("drafts", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  parentMessageId: uuid("parent_message_id").references(() => messages.id, { onDelete: "cascade" }),
  threadKey: text("thread_key").notNull().default("root"),
  bodyText: text("body_text").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.userId, table.conversationId, table.threadKey),
  index("drafts_user_idx").on(table.workspaceId, table.userId)
]);

export const scheduledMessages = pgTable("scheduled_messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parentMessageId: uuid("parent_message_id").references(() => messages.id, { onDelete: "cascade" }),
  bodyText: text("body_text").notNull(),
  fileIds: jsonb("file_ids").$type<string[]>(),
  sendAt: timestamp("send_at", { withTimezone: true }).notNull(),
  status: scheduledStatus("status").notNull().default("pending"),
  sentMessageId: uuid("sent_message_id"),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("scheduled_messages_due_idx").on(table.status, table.sendAt),
  index("scheduled_messages_sender_idx").on(table.workspaceId, table.senderId)
]);

export const reminders = pgTable("reminders", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
  text: text("text").notNull(),
  remindAt: timestamp("remind_at", { withTimezone: true }).notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  firedAt: timestamp("fired_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("reminders_due_idx").on(table.remindAt, table.firedAt),
  index("reminders_user_idx").on(table.workspaceId, table.userId)
]);

/* -------------------------------------------------------------------------- */
/* Files, emoji, link previews                                                 */
/* -------------------------------------------------------------------------- */

export const files = pgTable("files", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  uploaderId: uuid("uploader_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "set null" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  storageKey: text("storage_key").notNull(),
  width: integer("width"),
  height: integer("height"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true })
}, (table) => [
  index("files_workspace_idx").on(table.workspaceId, table.createdAt),
  index("files_message_idx").on(table.messageId)
]);

export const customEmoji = pgTable("custom_emoji", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  fileId: uuid("file_id").references(() => files.id, { onDelete: "cascade" }),
  imageUrl: text("image_url").notNull(),
  aliasFor: text("alias_for"),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.workspaceId, table.name)
]);

export const linkPreviews = pgTable("link_previews", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  title: text("title"),
  description: text("description"),
  imageUrl: text("image_url"),
  siteName: text("site_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  unique().on(table.messageId, table.url)
]);

/* -------------------------------------------------------------------------- */
/* Notifications, audit, exports                                               */
/* -------------------------------------------------------------------------- */

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
  body: text("body"),
  readAt: timestamp("read_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("notifications_user_idx").on(table.workspaceId, table.userId, table.readAt)
]);

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  type: text("type").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => [
  index("audit_events_workspace_idx").on(table.workspaceId, table.createdAt)
]);

export const exportJobs = pgTable("export_jobs", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  requestedByUserId: uuid("requested_by_user_id").notNull().references(() => users.id),
  status: exportStatus("status").notNull().default("queued"),
  fileUrl: text("file_url"),
  error: text("error"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
});

/* -------------------------------------------------------------------------- */
/* Types                                                                       */
/* -------------------------------------------------------------------------- */

export type UserPreferences = {
  theme?: "light" | "dark" | "system";
  messageDensity?: "comfortable" | "compact";
  timeFormat?: "12h" | "24h";
  enterToSend?: boolean;
  showUnreadsFirst?: boolean;
  emailNotifications?: "all" | "mentions" | "none";
  desktopNotifications?: "all" | "mentions" | "none";
  notificationSound?: boolean;
  skinTone?: number;
  keywords?: string[];
  /** Notification schedule, local `HH:MM` in the user's timezone. */
  quietHoursStart?: string | null;
  quietHoursEnd?: string | null;
};

export type User = typeof users.$inferSelect;
export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type Channel = typeof channels.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ConversationMember = typeof conversationMembers.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type NewMessage = typeof messages.$inferInsert;
export type MessageReaction = typeof messageReactions.$inferSelect;
export type FileRecord = typeof files.$inferSelect;
export type NotificationRecord = typeof notifications.$inferSelect;
export type NewNotification = typeof notifications.$inferInsert;
export type WorkspaceInvite = typeof workspaceInvites.$inferSelect;
export type Draft = typeof drafts.$inferSelect;
export type ScheduledMessage = typeof scheduledMessages.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type CustomEmoji = typeof customEmoji.$inferSelect;
export type SidebarSection = typeof sidebarSections.$inferSelect;
export type UserGroup = typeof userGroups.$inferSelect;
export type Webhook = typeof webhooks.$inferSelect;
export type ThreadSubscription = typeof threadSubscriptions.$inferSelect;
