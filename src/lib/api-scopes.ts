/**
 * Scopes for API keys.
 *
 * The public API is not a second implementation of the product — it is the same
 * route table the web client calls, with a second way to authenticate. This file
 * is the bridge: every route declares the scope a key must hold to call it, and
 * `assertRoutesAreClassified` fails the build if a new route forgets to. That
 * invariant is what makes "every action is scriptable" true and keeps it true.
 */

export type ScopeDefinition = {
  scope: string;
  summary: string;
};

/** Real scopes, in the order the admin console lists them. */
export const SCOPES: ScopeDefinition[] = [
  { scope: "messages:read", summary: "Read messages, threads, pins and search" },
  { scope: "messages:write", summary: "Post, edit, delete, react, pin, schedule and share messages" },
  { scope: "channels:read", summary: "List and inspect channels and their members" },
  { scope: "channels:write", summary: "Create, edit, archive channels and manage their membership" },
  { scope: "conversations:read", summary: "List conversations and read state" },
  { scope: "conversations:write", summary: "Open DMs, change read state and sidebar preferences" },
  { scope: "files:read", summary: "List and download files" },
  { scope: "files:write", summary: "Upload and delete files" },
  { scope: "users:read", summary: "Read member profiles and the mention directory" },
  { scope: "users:write", summary: "Update the key's own profile, status and presence" },
  { scope: "workspace:read", summary: "Read workspace settings, emoji, groups and sections" },
  { scope: "workspace:write", summary: "Change workspace settings, emoji, groups and sections" },
  { scope: "members:read", summary: "List members and pending invitations" },
  { scope: "members:write", summary: "Invite, change roles and remove members" },
  { scope: "activity:read", summary: "Read notifications, saved items, drafts, reminders and unreads" },
  { scope: "activity:write", summary: "Mark notifications read and manage reminders and scheduled sends" },
  { scope: "webhooks:read", summary: "List incoming webhooks" },
  { scope: "webhooks:write", summary: "Create and revoke incoming webhooks" },
  { scope: "admin:read", summary: "Read the audit log and export history" },
  { scope: "admin:write", summary: "Request exports and delete the workspace" },
  { scope: "api_keys:read", summary: "List API keys" },
  { scope: "api_keys:write", summary: "Create, edit, rotate and revoke API keys" }
];

export const SCOPE_NAMES = SCOPES.map((entry) => entry.scope);

/**
 * Access classes that are not scopes:
 * - `public`   no credential at all (invite previews, incoming webhooks)
 * - `session`  browser sessions only — credential management a key must not touch
 * - `identity` any live key, no particular scope (`/auth/me` as whoami)
 */
export const SESSION_ONLY = "session";
export const PUBLIC_ROUTE = "public";
export const IDENTITY_ROUTE = "identity";

export type RouteAccess = string;

/**
 * Every route in the application, classified. Adding a route without adding it
 * here throws at startup, by design.
 */
export const ROUTE_ACCESS: Record<string, RouteAccess> = {
  /* Credentials: a key is a credential, so it may never mint or manage others. */
  "POST /auth/signup": SESSION_ONLY,
  "POST /auth/login": SESSION_ONLY,
  "POST /auth/logout": SESSION_ONLY,
  "POST /auth/forgot-password": PUBLIC_ROUTE,
  "POST /auth/reset-password": PUBLIC_ROUTE,
  "POST /auth/change-password": SESSION_ONLY,
  "POST /auth/verify-email": PUBLIC_ROUTE,
  "POST /auth/resend-verification": SESSION_ONLY,
  "GET /auth/sessions": SESSION_ONLY,
  "DELETE /auth/sessions/:sessionId": SESSION_ONLY,
  "DELETE /auth/account": SESSION_ONLY,
  "GET /auth/me": IDENTITY_ROUTE,

  /* Users and presence */
  "PATCH /users/me": "users:write",
  "PATCH /users/me/preferences": "users:write",
  "PUT /users/me/status": "users:write",
  "PUT /users/me/presence": "users:write",
  "POST /users/me/heartbeat": "users:write",
  "GET /users/:userId": "users:read",
  "GET /workspaces/:workspaceId/directory": "users:read",

  /* Workspaces. Creating one is outside any key's workspace binding. */
  "POST /workspaces": SESSION_ONLY,
  "GET /workspaces": SESSION_ONLY,
  "GET /workspaces/:workspaceId": "workspace:read",
  "GET /workspaces/:workspaceId/bootstrap": "workspace:read",
  "PATCH /workspaces/:workspaceId": "workspace:write",
  "DELETE /workspaces/:workspaceId": "admin:write",
  "GET /workspaces/:workspaceId/members": "members:read",
  "PATCH /workspaces/:workspaceId/members/:memberId": "members:write",
  "DELETE /workspaces/:workspaceId/members/:memberId": "members:write",
  "GET /workspaces/:workspaceId/usage": "workspace:read",
  "GET /workspaces/:workspaceId/audit-events": "admin:read",
  "GET /workspaces/:workspaceId/exports": "admin:read",
  "POST /workspaces/:workspaceId/exports": "admin:write",
  "POST /workspaces/:workspaceId/sections": "workspace:write",
  "PATCH /sections/:sectionId": "workspace:write",
  "DELETE /sections/:sectionId": "workspace:write",
  "GET /workspaces/:workspaceId/emoji": "workspace:read",
  "POST /workspaces/:workspaceId/emoji": "workspace:write",
  "DELETE /emoji/:emojiId": "workspace:write",
  "GET /workspaces/:workspaceId/user-groups": "workspace:read",
  "POST /workspaces/:workspaceId/user-groups": "workspace:write",
  "PATCH /user-groups/:groupId": "workspace:write",
  "DELETE /user-groups/:groupId": "workspace:write",

  /* Invitations */
  "GET /workspaces/:workspaceId/invites": "members:read",
  "POST /workspaces/:workspaceId/invites": "members:write",
  "POST /workspaces/:workspaceId/invite-links": "members:write",
  "POST /invites/preview": PUBLIC_ROUTE,
  "POST /invites/accept": SESSION_ONLY,
  "POST /invites/:inviteId/revoke": "members:write",
  "POST /invites/:inviteId/resend": "members:write",

  /* Channels */
  "GET /workspaces/:workspaceId/channels": "channels:read",
  "POST /workspaces/:workspaceId/channels": "channels:write",
  "GET /channels/:channelId": "channels:read",
  "PATCH /channels/:channelId": "channels:write",
  "POST /channels/:channelId/join": "channels:write",
  "POST /channels/:channelId/leave": "channels:write",
  "POST /channels/:channelId/archive": "channels:write",
  "POST /channels/:channelId/unarchive": "channels:write",
  "GET /channels/:channelId/members": "channels:read",
  "POST /channels/:channelId/members": "channels:write",
  "DELETE /channels/:channelId/members/:userId": "channels:write",
  "GET /channels/:channelId/bookmarks": "channels:read",
  "POST /channels/:channelId/bookmarks": "channels:write",
  "DELETE /bookmarks/:bookmarkId": "channels:write",

  /* Conversations */
  "GET /workspaces/:workspaceId/conversations": "conversations:read",
  "POST /conversations/dm": "conversations:write",
  "GET /conversations/:conversationId": "conversations:read",
  "GET /conversations/:conversationId/messages": "messages:read",
  "POST /conversations/:conversationId/messages": "messages:write",
  "POST /conversations/:conversationId/read": "conversations:write",
  "POST /conversations/:conversationId/unread": "conversations:write",
  "PATCH /conversations/:conversationId/membership": "conversations:write",
  "GET /conversations/:conversationId/pins": "messages:read",
  "GET /conversations/:conversationId/files": "files:read",
  "PUT /conversations/:conversationId/draft": "messages:write",
  "POST /conversations/:conversationId/scheduled": "messages:write",
  "POST /conversations/:conversationId/typing": "messages:write",

  /* Messages */
  "GET /messages/:messageId": "messages:read",
  "PATCH /messages/:messageId": "messages:write",
  "DELETE /messages/:messageId": "messages:write",
  "GET /messages/:messageId/thread": "messages:read",
  "POST /messages/:messageId/reactions": "messages:write",
  "DELETE /messages/:messageId/reactions/:emoji": "messages:write",
  "POST /messages/:messageId/pin": "messages:write",
  "DELETE /messages/:messageId/pin": "messages:write",
  "POST /messages/:messageId/save": "activity:write",
  "DELETE /messages/:messageId/save": "activity:write",
  "POST /messages/:messageId/remind": "activity:write",
  "POST /messages/:messageId/follow": "messages:write",
  "POST /messages/:messageId/share": "messages:write",

  /* Integrations */
  "GET /channels/:channelId/webhooks": "webhooks:read",
  "POST /channels/:channelId/webhooks": "webhooks:write",
  "DELETE /webhooks/:webhookId": "webhooks:write",
  "POST /hooks/:webhookId/:token": PUBLIC_ROUTE,

  /* API keys */
  "GET /workspaces/:workspaceId/api-keys": "api_keys:read",
  "POST /workspaces/:workspaceId/api-keys": "api_keys:write",
  "GET /api-keys/:keyId": "api_keys:read",
  "PATCH /api-keys/:keyId": "api_keys:write",
  "POST /api-keys/:keyId/rotate": "api_keys:write",
  "DELETE /api-keys/:keyId": "api_keys:write",

  /* Files */
  "POST /files": "files:write",
  "GET /files/:fileId/download": "files:read",
  "DELETE /files/:fileId": "files:write",

  /* Activity and search */
  "GET /workspaces/:workspaceId/search": "messages:read",
  "GET /workspaces/:workspaceId/notifications": "activity:read",
  "POST /workspaces/:workspaceId/notifications/read": "activity:write",
  "GET /workspaces/:workspaceId/threads": "activity:read",
  "GET /workspaces/:workspaceId/saved": "activity:read",
  "GET /workspaces/:workspaceId/drafts": "activity:read",
  "GET /workspaces/:workspaceId/unreads": "activity:read",
  "GET /workspaces/:workspaceId/files": "files:read",
  "GET /workspaces/:workspaceId/scheduled": "activity:read",
  "DELETE /scheduled/:scheduledId": "activity:write",
  "GET /workspaces/:workspaceId/reminders": "activity:read",
  "POST /workspaces/:workspaceId/reminders": "activity:write",
  "POST /reminders/:reminderId/complete": "activity:write",
  "GET /commands": IDENTITY_ROUTE,

  /* Discovery */
  "GET /meta": PUBLIC_ROUTE,
  "GET /meta/routes": PUBLIC_ROUTE,
  "GET /meta/scopes": PUBLIC_ROUTE,
  "GET /meta/openapi.json": PUBLIC_ROUTE
};

export function accessFor(spec: string): RouteAccess {
  const access = ROUTE_ACCESS[spec];
  if (!access) throw new Error(`Route ${spec} has no API access class. Add one to ROUTE_ACCESS.`);
  return access;
}

/** Called once at startup so an unclassified route can never ship. */
export function assertRoutesAreClassified(specs: string[]) {
  const missing = specs.filter((spec) => !ROUTE_ACCESS[spec]);
  if (missing.length > 0) {
    throw new Error(
      `These routes are missing an entry in ROUTE_ACCESS (src/lib/api-scopes.ts):\n  ${missing.join("\n  ")}`
    );
  }
  const known = new Set(specs);
  const stale = Object.keys(ROUTE_ACCESS).filter((spec) => !known.has(spec));
  if (stale.length > 0) {
    throw new Error(`ROUTE_ACCESS lists routes that no longer exist:\n  ${stale.join("\n  ")}`);
  }
}

export function isRealScope(scope: string) {
  return SCOPE_NAMES.includes(scope);
}

/**
 * `*` grants everything and `messages:*` grants a whole resource, so a key can
 * be handed a short, readable scope list.
 */
export function grantsScope(granted: string[], required: string) {
  if (granted.includes("*")) return true;
  if (granted.includes(required)) return true;
  const [resource] = required.split(":");
  return granted.includes(`${resource}:*`);
}

/** Expands wildcards for display, and rejects anything unrecognised. */
export function normalizeScopes(requested: string[]): string[] {
  const expanded = new Set<string>();
  for (const raw of requested) {
    const scope = raw.trim();
    if (!scope) continue;
    if (scope === "*") {
      SCOPE_NAMES.forEach((name) => expanded.add(name));
      continue;
    }
    if (scope.endsWith(":*")) {
      const resource = scope.slice(0, -2);
      const matches = SCOPE_NAMES.filter((name) => name.startsWith(`${resource}:`));
      if (matches.length === 0) throw new Error(`Unknown scope: ${scope}`);
      matches.forEach((name) => expanded.add(name));
      continue;
    }
    if (!isRealScope(scope)) throw new Error(`Unknown scope: ${scope}`);
    expanded.add(scope);
  }
  return SCOPE_NAMES.filter((name) => expanded.has(name));
}
