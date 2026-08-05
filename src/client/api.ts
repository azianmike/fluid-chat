import type {
  BookmarkDto,
  ChannelSummary,
  ConversationSummary,
  CustomEmojiDto,
  DraftDto,
  FileSummary,
  MessageDto,
  NotificationDto,
  PublicUser,
  ReactionSummary,
  ReminderDto,
  ScheduledMessageDto,
  SessionUser,
  SidebarSectionDto,
  UserGroupDto,
  WorkspaceBootstrap,
  WorkspaceMembership,
  WorkspaceSummary
} from "@/shared/types";

export type ApiKeyDto = {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  workspaceId: string;
  actor: { id: string; displayName: string; handle: string | null; isBot: boolean };
  rateLimitPerMinute: number;
  messageLimitPerMinute: number;
  requestCount: number;
  lastUsedAt: string | null;
  lastUsedIp: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdByUserId: string;
  createdAt: string;
};

export type CreateApiKeyInput = {
  name: string;
  scopes: string[];
  identity?: "bot" | "self";
  botRole?: "member" | "admin";
  rateLimitPerMinute?: number;
  messageLimitPerMinute?: number;
  expiresInDays?: number | null;
};

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string
  ) {
    super(message);
  }
}

type RequestInitWithBody = Omit<RequestInit, "body"> & { body?: unknown };

async function request<T>(path: string, init?: RequestInitWithBody): Promise<T> {
  const isForm = init?.body instanceof FormData;
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      ...(isForm ? {} : { "content-type": "application/json" }),
      ...(init?.headers as Record<string, string> | undefined)
    },
    body: init?.body === undefined ? undefined : isForm ? (init.body as FormData) : JSON.stringify(init.body)
  });

  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new ApiError(
      (data as { error?: string }).error ?? "Request failed",
      response.status,
      (data as { code?: string }).code ?? "request_error"
    );
  }
  return data as T;
}

const get = <T>(path: string) => request<T>(path);
const post = <T>(path: string, body?: unknown) => request<T>(path, { method: "POST", body });
const patch = <T>(path: string, body?: unknown) => request<T>(path, { method: "PATCH", body });
const put = <T>(path: string, body?: unknown) => request<T>(path, { method: "PUT", body });
const del = <T>(path: string, body?: unknown) => request<T>(path, { method: "DELETE", body });

export type SlashOutcome =
  | { kind: "message"; message: MessageDto }
  | { kind: "ephemeral"; text: string }
  | { kind: "navigate"; conversationId: string; text?: string };

export const api = {
  auth: {
    me: () => get<{ user: SessionUser | null; workspaces: WorkspaceMembership[] }>("/auth/me"),
    login: (email: string, password: string) =>
      post<{ user: SessionUser; workspaces: WorkspaceMembership[] }>("/auth/login", { email, password }),
    signup: (input: { email: string; password: string; displayName: string }) =>
      post<{ user: SessionUser; workspaces: WorkspaceMembership[] }>("/auth/signup", input),
    logout: () => post<{ ok: true }>("/auth/logout"),
    forgotPassword: (email: string) => post<{ ok: true; resetToken?: string }>("/auth/forgot-password", { email }),
    resetPassword: (token: string, password: string) => post<{ ok: true }>("/auth/reset-password", { token, password }),
    changePassword: (currentPassword: string, newPassword: string) =>
      post<{ ok: true }>("/auth/change-password", { currentPassword, newPassword }),
    verifyEmail: (token: string) => post<{ ok: true }>("/auth/verify-email", { token }),
    resendVerification: () => post<{ ok: true }>("/auth/resend-verification"),
    sessions: () =>
      get<{ sessions: Array<{ id: string; userAgent: string | null; ipAddress: string | null; createdAt: string }> }>(
        "/auth/sessions"
      ),
    revokeSession: (sessionId: string) => del<{ ok: true }>(`/auth/sessions/${sessionId}`)
  },

  users: {
    updateProfile: (input: Partial<Record<string, unknown>>) => patch<{ user: SessionUser }>("/users/me", input),
    updatePreferences: (input: Record<string, unknown>) =>
      patch<{ user: SessionUser }>("/users/me/preferences", input),
    setStatus: (input: { emoji: string | null; text: string | null; expiresAt?: string | null }) =>
      put<{ user: SessionUser }>("/users/me/status", input),
    setPresence: (presence: "active" | "away" | "dnd" | "offline", dndUntil?: string | null) =>
      put<{ user: SessionUser }>("/users/me/presence", { presence, dndUntil }),
    heartbeat: () => post<{ presence: string }>("/users/me/heartbeat"),
    profile: (userId: string) => get<{ user: PublicUser }>(`/users/${userId}`)
  },

  workspaces: {
    list: () => get<{ workspaces: WorkspaceMembership[] }>("/workspaces"),
    create: (name: string) => post<{ workspace: WorkspaceSummary }>("/workspaces", { name }),
    bootstrap: (workspaceId: string) => get<WorkspaceBootstrap>(`/workspaces/${workspaceId}/bootstrap`),
    update: (workspaceId: string, input: Record<string, unknown>) =>
      patch<{ workspace: WorkspaceSummary }>(`/workspaces/${workspaceId}`, input),
    members: (workspaceId: string, includeRemoved = false) =>
      get<{ members: Array<{ memberId: string; role: string; status: string; user: PublicUser }> }>(
        `/workspaces/${workspaceId}/members${includeRemoved ? "?includeRemoved=true" : ""}`
      ),
    updateMember: (workspaceId: string, memberId: string, input: { role?: string; status?: string }) =>
      patch<{ member: unknown }>(`/workspaces/${workspaceId}/members/${memberId}`, input),
    removeMember: (workspaceId: string, memberId: string) =>
      del<{ ok: true }>(`/workspaces/${workspaceId}/members/${memberId}`),
    usage: (workspaceId: string) =>
      get<{ workspace: WorkspaceSummary; usage: { activeMembers: number; pendingInvites: number; fileCount: number } }>(
        `/workspaces/${workspaceId}/usage`
      ),
    auditEvents: (workspaceId: string) =>
      get<{
        auditEvents: Array<{
          id: string;
          type: string;
          createdAt: string;
          metadata: unknown;
          actor: { id: string; displayName: string } | null;
        }>;
      }>(`/workspaces/${workspaceId}/audit-events`),
    exports: (workspaceId: string) =>
      get<{ exportJobs: Array<{ id: string; status: string; createdAt: string; fileUrl: string | null }> }>(
        `/workspaces/${workspaceId}/exports`
      ),
    requestExport: (workspaceId: string) => post<{ exportJob: unknown }>(`/workspaces/${workspaceId}/exports`),
    directory: (workspaceId: string) =>
      get<{
        people: Array<{ id: string; displayName: string; handle: string | null; avatarUrl: string | null; title: string | null }>;
        groups: Array<{ id: string; handle: string; name: string }>;
      }>(`/workspaces/${workspaceId}/directory`),
    emoji: (workspaceId: string) => get<{ emoji: CustomEmojiDto[] }>(`/workspaces/${workspaceId}/emoji`),
    createEmoji: (workspaceId: string, name: string, fileId: string) =>
      post<{ emoji: CustomEmojiDto }>(`/workspaces/${workspaceId}/emoji`, { name, fileId }),
    deleteEmoji: (emojiId: string) => del<{ ok: true }>(`/emoji/${emojiId}`),
    userGroups: (workspaceId: string) => get<{ groups: UserGroupDto[] }>(`/workspaces/${workspaceId}/user-groups`),
    createUserGroup: (workspaceId: string, input: { handle: string; name: string; memberIds?: string[] }) =>
      post<{ group: UserGroupDto }>(`/workspaces/${workspaceId}/user-groups`, input),
    createSection: (workspaceId: string, name: string) =>
      post<{ section: SidebarSectionDto }>(`/workspaces/${workspaceId}/sections`, { name }),
    updateSection: (sectionId: string, input: Partial<SidebarSectionDto>) =>
      patch<{ section: SidebarSectionDto }>(`/sections/${sectionId}`, input),
    deleteSection: (sectionId: string) => del<{ ok: true }>(`/sections/${sectionId}`)
  },

  apiKeys: {
    scopes: () => get<{ scopes: Array<{ scope: string; summary: string }> }>("/meta/scopes"),
    list: (workspaceId: string, includeRevoked = false) =>
      get<{ apiKeys: ApiKeyDto[] }>(
        `/workspaces/${workspaceId}/api-keys${includeRevoked ? "?includeRevoked=true" : ""}`
      ),
    create: (workspaceId: string, input: CreateApiKeyInput) =>
      post<{ apiKey: ApiKeyDto; token: string }>(`/workspaces/${workspaceId}/api-keys`, input),
    update: (keyId: string, input: Partial<CreateApiKeyInput>) =>
      patch<{ apiKey: ApiKeyDto }>(`/api-keys/${keyId}`, input),
    rotate: (keyId: string) => post<{ apiKey: ApiKeyDto; token: string }>(`/api-keys/${keyId}/rotate`),
    revoke: (keyId: string) => del<{ ok: true }>(`/api-keys/${keyId}`)
  },

  invites: {
    list: (workspaceId: string) =>
      get<{
        invites: Array<{
          id: string;
          email: string | null;
          role: string;
          inviteType: string;
          expiresAt: string;
          acceptedAt: string | null;
          revokedAt: string | null;
          useCount: number;
          maxUses: number | null;
        }>;
      }>(`/workspaces/${workspaceId}/invites`),
    send: (workspaceId: string, emails: string[], role: "member" | "admin" | "guest" = "member") =>
      post<{ invites: Array<{ id: string; email: string | null; inviteUrl: string }>; skipped: string[] }>(
        `/workspaces/${workspaceId}/invites`,
        { emails, role }
      ),
    createLink: (workspaceId: string, input: { maxUses?: number; expiresInDays?: number }) =>
      post<{ inviteUrl: string }>(`/workspaces/${workspaceId}/invite-links`, input),
    preview: (token: string) =>
      post<{ invite: { email: string | null; role: string }; workspace: WorkspaceSummary }>("/invites/preview", {
        token
      }),
    accept: (token: string) => post<{ workspaceId: string; alreadyMember: boolean }>("/invites/accept", { token }),
    revoke: (inviteId: string) => post<{ ok: true }>(`/invites/${inviteId}/revoke`),
    resend: (inviteId: string) => post<{ inviteUrl: string }>(`/invites/${inviteId}/resend`)
  },

  channels: {
    list: (workspaceId: string, options?: { includeArchived?: boolean; q?: string }) => {
      const params = new URLSearchParams();
      if (options?.includeArchived) params.set("includeArchived", "true");
      if (options?.q) params.set("q", options.q);
      const suffix = params.toString() ? `?${params}` : "";
      return get<{ channels: Array<ChannelSummary & { conversationId: string; joined: boolean }> }>(
        `/workspaces/${workspaceId}/channels${suffix}`
      );
    },
    create: (
      workspaceId: string,
      input: { name: string; visibility: "public" | "private"; description?: string; memberIds?: string[] }
    ) => post<{ channel: ChannelSummary; conversationId: string }>(`/workspaces/${workspaceId}/channels`, input),
    get: (channelId: string) =>
      get<{ channel: ChannelSummary; conversationId: string; joined: boolean; members: PublicUser[] }>(
        `/channels/${channelId}`
      ),
    update: (channelId: string, input: Record<string, unknown>) =>
      patch<{ channel: ChannelSummary }>(`/channels/${channelId}`, input),
    join: (channelId: string) => post<{ conversationId: string }>(`/channels/${channelId}/join`),
    leave: (channelId: string) => post<{ ok: true }>(`/channels/${channelId}/leave`),
    archive: (channelId: string) => post<{ ok: true }>(`/channels/${channelId}/archive`),
    unarchive: (channelId: string) => post<{ ok: true }>(`/channels/${channelId}/unarchive`),
    members: (channelId: string) => get<{ members: PublicUser[] }>(`/channels/${channelId}/members`),
    addMembers: (channelId: string, userIds: string[]) =>
      post<{ added: string[] }>(`/channels/${channelId}/members`, { userIds }),
    removeMember: (channelId: string, userId: string) => del<{ ok: true }>(`/channels/${channelId}/members/${userId}`),
    webhooks: (channelId: string) =>
      get<{
        webhooks: Array<{ id: string; name: string; createdAt: string; lastUsedAt: string | null }>;
      }>(`/channels/${channelId}/webhooks`),
    createWebhook: (channelId: string, name: string) =>
      post<{ webhook: { id: string; name: string }; url: string }>(`/channels/${channelId}/webhooks`, { name }),
    deleteWebhook: (webhookId: string) => del<{ ok: true }>(`/webhooks/${webhookId}`),
    bookmarks: (channelId: string) => get<{ bookmarks: BookmarkDto[] }>(`/channels/${channelId}/bookmarks`),
    addBookmark: (channelId: string, input: { title: string; url: string; emoji?: string }) =>
      post<{ bookmark: BookmarkDto }>(`/channels/${channelId}/bookmarks`, input),
    deleteBookmark: (bookmarkId: string) => del<{ ok: true }>(`/bookmarks/${bookmarkId}`)
  },

  conversations: {
    list: (workspaceId: string) =>
      get<{ conversations: ConversationSummary[] }>(`/workspaces/${workspaceId}/conversations`),
    openDm: (workspaceId: string, userIds: string[]) =>
      post<{ conversation: ConversationSummary }>("/conversations/dm", { workspaceId, userIds }),
    get: (conversationId: string) =>
      get<{ conversation: ConversationSummary; members: PublicUser[]; label: string }>(
        `/conversations/${conversationId}`
      ),
    messages: (conversationId: string, options?: { before?: string; after?: string; limit?: number }) => {
      const params = new URLSearchParams();
      if (options?.before) params.set("before", options.before);
      if (options?.after) params.set("after", options.after);
      if (options?.limit) params.set("limit", String(options.limit));
      const suffix = params.toString() ? `?${params}` : "";
      return get<{ messages: MessageDto[]; hasMore: boolean }>(`/conversations/${conversationId}/messages${suffix}`);
    },
    send: (
      conversationId: string,
      input: {
        bodyText: string;
        clientMessageId?: string;
        parentMessageId?: string;
        threadBroadcast?: boolean;
        fileIds?: string[];
      }
    ) => post<{ message?: MessageDto; command?: SlashOutcome }>(`/conversations/${conversationId}/messages`, input),
    markRead: (conversationId: string, messageId?: string) =>
      post<{ lastReadAt: string }>(`/conversations/${conversationId}/read`, { messageId }),
    markUnread: (conversationId: string, beforeMessageId?: string) =>
      post<{ ok: true }>(`/conversations/${conversationId}/unread`, { beforeMessageId }),
    updateMembership: (
      conversationId: string,
      input: {
        starred?: boolean;
        muted?: boolean;
        notificationLevel?: "all" | "mentions" | "none";
        sectionId?: string | null;
        hidden?: boolean;
      }
    ) => patch<{ membership: unknown }>(`/conversations/${conversationId}/membership`, input),
    pins: (conversationId: string) =>
      get<{ pins: Array<{ message: MessageDto; pinnedByUserId: string; pinnedAt: string }> }>(
        `/conversations/${conversationId}/pins`
      ),
    files: (conversationId: string) => get<{ files: FileSummary[] }>(`/conversations/${conversationId}/files`),
    saveDraft: (conversationId: string, bodyText: string, parentMessageId?: string | null) =>
      put<{ draft: DraftDto | null }>(`/conversations/${conversationId}/draft`, { bodyText, parentMessageId }),
    schedule: (conversationId: string, input: { bodyText: string; sendAt: string; parentMessageId?: string | null }) =>
      post<{ scheduled: ScheduledMessageDto }>(`/conversations/${conversationId}/scheduled`, input),
    typing: (conversationId: string, parentMessageId?: string | null) =>
      post<{ ok: true }>(`/conversations/${conversationId}/typing`, { parentMessageId })
  },

  messages: {
    thread: (messageId: string) => get<{ messages: MessageDto[] }>(`/messages/${messageId}/thread`),
    update: (messageId: string, bodyText: string) => patch<{ message: MessageDto }>(`/messages/${messageId}`, { bodyText }),
    remove: (messageId: string) => del<{ ok: true }>(`/messages/${messageId}`),
    addReaction: (messageId: string, emoji: string) =>
      post<{ reactions: ReactionSummary[] }>(`/messages/${messageId}/reactions`, { emoji }),
    removeReaction: (messageId: string, emoji: string) =>
      del<{ reactions: ReactionSummary[] }>(`/messages/${messageId}/reactions/${encodeURIComponent(emoji)}`),
    pin: (messageId: string) => post<{ ok: true }>(`/messages/${messageId}/pin`),
    unpin: (messageId: string) => del<{ ok: true }>(`/messages/${messageId}/pin`),
    save: (messageId: string) => post<{ ok: true }>(`/messages/${messageId}/save`),
    unsave: (messageId: string) => del<{ ok: true }>(`/messages/${messageId}/save`),
    remind: (messageId: string, inText: string) => post<{ reminder: ReminderDto }>(`/messages/${messageId}/remind`, { inText }),
    follow: (messageId: string, state: "following" | "muted") =>
      post<{ state: string }>(`/messages/${messageId}/follow`, { state }),
    share: (messageId: string, input: { conversationId?: string; userIds?: string[]; comment?: string }) =>
      post<{ message: MessageDto; conversationId: string }>(`/messages/${messageId}/share`, input)
  },

  files: {
    upload: (workspaceId: string, file: File, conversationId?: string | null) => {
      const form = new FormData();
      form.set("workspaceId", workspaceId);
      if (conversationId) form.set("conversationId", conversationId);
      form.set("file", file);
      return request<{ file: FileSummary }>("/files", { method: "POST", body: form });
    },
    remove: (fileId: string) => del<{ ok: true }>(`/files/${fileId}`)
  },

  activity: {
    search: (workspaceId: string, query: string, sort: "recent" | "relevant" = "recent") =>
      get<{
        results: Array<{ message: MessageDto; conversationId: string; channelName: string | null }>;
      }>(`/workspaces/${workspaceId}/search?q=${encodeURIComponent(query)}&sort=${sort}`),
    notifications: (workspaceId: string) =>
      get<{ notifications: NotificationDto[]; unreadCount: number }>(`/workspaces/${workspaceId}/notifications`),
    markNotificationsRead: (workspaceId: string, notificationIds?: string[]) =>
      post<{ ok: true }>(`/workspaces/${workspaceId}/notifications/read`, { notificationIds }),
    threads: (workspaceId: string) =>
      get<{ threads: Array<{ root: MessageDto; replies: MessageDto[] }> }>(`/workspaces/${workspaceId}/threads`),
    saved: (workspaceId: string) =>
      get<{ saved: Array<{ message: MessageDto; savedAt: string }> }>(`/workspaces/${workspaceId}/saved`),
    drafts: (workspaceId: string) =>
      get<{ drafts: Array<DraftDto & { threadKey: string }> }>(`/workspaces/${workspaceId}/drafts`),
    unreads: (workspaceId: string) =>
      get<{ unreads: Array<{ conversationId: string; messages: MessageDto[] }> }>(`/workspaces/${workspaceId}/unreads`),
    files: (workspaceId: string) => get<{ files: FileSummary[] }>(`/workspaces/${workspaceId}/files`),
    scheduled: (workspaceId: string) =>
      get<{ scheduled: ScheduledMessageDto[] }>(`/workspaces/${workspaceId}/scheduled`),
    cancelScheduled: (scheduledId: string) => del<{ ok: true }>(`/scheduled/${scheduledId}`),
    reminders: (workspaceId: string) => get<{ reminders: ReminderDto[] }>(`/workspaces/${workspaceId}/reminders`),
    completeReminder: (reminderId: string) => post<{ reminder: ReminderDto }>(`/reminders/${reminderId}/complete`),
    commands: () => get<{ commands: Array<{ name: string; usage: string; description: string }> }>("/commands")
  }
};
