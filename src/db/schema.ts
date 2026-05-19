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

export const workspaceRole = pgEnum("workspace_role", ["owner", "admin", "member"]);
export const memberStatus = pgEnum("member_status", ["active", "removed", "suspended"]);
export const inviteType = pgEnum("invite_type", ["email", "link"]);
export const channelVisibility = pgEnum("channel_visibility", ["public", "private"]);
export const conversationType = pgEnum("conversation_type", ["channel", "dm", "group_dm"]);
export const exportStatus = pgEnum("export_status", ["queued", "processing", "ready", "failed", "expired"]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
};

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  }
});

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: text("email").notNull().unique(),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  passwordHash: text("password_hash"),
  displayName: text("display_name").notNull(),
  avatarUrl: text("avatar_url"),
  ...timestamps
});

export const sessions = pgTable("sessions", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
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

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  logoUrl: text("logo_url"),
  plan: text("plan").notNull().default("free"),
  stripeCustomerId: text("stripe_customer_id"),
  subscriptionStatus: text("subscription_status").notNull().default("active"),
  seatLimit: integer("seat_limit").notNull().default(5),
  overageAllowed: boolean("overage_allowed").notNull().default(false),
  gracePeriodEndsAt: timestamp("grace_period_ends_at", { withTimezone: true }),
  readOnlyAt: timestamp("read_only_at", { withTimezone: true }),
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
}, (table) => ({
  uniqueWorkspaceUser: unique().on(table.workspaceId, table.userId),
  workspaceUserIdx: index("workspace_members_workspace_user_idx").on(table.workspaceId, table.userId)
}));

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
}, (table) => ({
  inviteWorkspaceEmailIdx: index("workspace_invites_workspace_email_idx").on(table.workspaceId, table.email)
}));

export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  description: text("description"),
  topic: text("topic"),
  visibility: channelVisibility("visibility").notNull().default("public"),
  autoJoin: boolean("auto_join").notNull().default(false),
  createdByUserId: uuid("created_by_user_id").notNull().references(() => users.id),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  ...timestamps
}, (table) => ({
  uniqueWorkspaceChannelName: unique().on(table.workspaceId, table.name)
}));

export const conversations = pgTable("conversations", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  type: conversationType("type").notNull(),
  channelId: uuid("channel_id").references(() => channels.id, { onDelete: "cascade" }),
  ...timestamps
}, (table) => ({
  conversationWorkspaceIdx: index("conversations_workspace_idx").on(table.workspaceId)
}));

export const conversationMembers = pgTable("conversation_members", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  role: text("role"),
  lastReadMessageId: uuid("last_read_message_id"),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  mutedAt: timestamp("muted_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull(),
  leftAt: timestamp("left_at", { withTimezone: true })
}, (table) => ({
  uniqueConversationUser: unique().on(table.conversationId, table.userId),
  conversationMembersUserIdx: index("conversation_members_user_idx").on(table.workspaceId, table.userId)
}));

export const messages = pgTable("messages", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  conversationId: uuid("conversation_id").notNull().references(() => conversations.id, { onDelete: "cascade" }),
  senderId: uuid("sender_id").notNull().references(() => users.id),
  parentMessageId: uuid("parent_message_id"),
  clientMessageId: text("client_message_id"),
  bodyText: text("body_text").notNull(),
  bodyJson: jsonb("body_json"),
  editedAt: timestamp("edited_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  deletedByUserId: uuid("deleted_by_user_id").references(() => users.id),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  searchVector: tsvector("search_vector").generatedAlwaysAs(sql`to_tsvector('simple', coalesce(body_text, ''))`)
}, (table) => ({
  uniqueSenderClientMessage: unique().on(table.senderId, table.clientMessageId),
  messageConversationIdx: index("messages_conversation_idx").on(table.conversationId, table.createdAt),
  messageWorkspaceIdx: index("messages_workspace_idx").on(table.workspaceId),
  messageSearchIdx: index("messages_search_idx").using("gin", table.searchVector)
}));

export const messageReactions = pgTable("message_reactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").notNull().references(() => messages.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  emoji: text("emoji").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  uniqueMessageUserEmoji: unique().on(table.messageId, table.userId, table.emoji)
}));

export const notifications = pgTable("notifications", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  conversationId: uuid("conversation_id").references(() => conversations.id, { onDelete: "cascade" }),
  messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
  readAt: timestamp("read_at", { withTimezone: true }),
  emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  notificationUserIdx: index("notifications_user_idx").on(table.workspaceId, table.userId, table.readAt)
}));

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  workspaceId: uuid("workspace_id").notNull().references(() => workspaces.id, { onDelete: "cascade" }),
  actorUserId: uuid("actor_user_id").references(() => users.id),
  type: text("type").notNull(),
  entityType: text("entity_type"),
  entityId: uuid("entity_id"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
}, (table) => ({
  auditWorkspaceIdx: index("audit_events_workspace_idx").on(table.workspaceId, table.createdAt)
}));

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

export type User = typeof users.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
