# API reference

Every endpoint lives under `/api`. Requests and responses are JSON (file upload and download are
the exceptions). Errors return `{ "error": string, "code": string }` with a matching status.

Two credentials reach the same routes:

- **Session cookie** — what the web client uses. `HttpOnly`, origin checked on writes, rate limited.
- **API key** — `Authorization: Bearer fluid_sk_…`, created by a workspace admin. Scoped, pinned to
  one workspace and rate limited per key. See **[API keys](api-keys.md)**.

The tables below mark the scope each route needs. `session` means browser-only by design (credential
management), and `public` means no authentication at all. Anything else a person can do in the UI,
a key with the right scope can automate.

Print the live route table any time with:

```bash
npx tsx -e "import('./src/server/index.ts').then(m => console.log(m.routeTable.sort().join('\n')))"
```

Or fetch it, with scopes, from a running server — this is also how an agent discovers the surface:

```bash
curl -s localhost:3000/api/meta/routes | jq
curl -s localhost:3000/api/meta/openapi.json > openapi.json
```

## Auth and account

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST | `/auth/signup` | `session` | Creates the user, session and email verification token |
| POST | `/auth/login` | `session` | Email + password |
| POST | `/auth/logout` | `session` | Clears the session |
| GET | `/auth/me` | any key | Current user and workspace memberships — the whoami for a key |
| POST | `/auth/forgot-password` | `public` | Always 200; returns the token only when SMTP is unset |
| POST | `/auth/reset-password` | `public` | Consumes the token and revokes all sessions |
| POST | `/auth/change-password` | `session` | Requires the current password |
| POST | `/auth/verify-email`, `/auth/resend-verification` | `public` / `session` | Email verification |
| GET/DELETE | `/auth/sessions`, `/auth/sessions/:sessionId` | `session` | Device list and revocation |
| DELETE | `/auth/account` | `session` | Closes an account that owns no workspaces |

## Users and presence

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| PATCH | `/users/me` | `users:write` | Name, handle, title, pronouns, phone, timezone, avatar |
| PATCH | `/users/me/preferences` | `users:write` | Theme, density, notifications, keywords, skin tone |
| PUT | `/users/me/status` | `users:write` | Emoji, text, optional expiry |
| PUT | `/users/me/presence` | `users:write` | `active` / `away` / `dnd` / `offline` (+ `dndUntil`) |
| POST | `/users/me/heartbeat` | `users:write` | Keeps presence fresh; called by the client every minute |
| GET | `/users/:userId` | `users:read` | Profile, restricted to shared workspaces |
| GET | `/workspaces/:workspaceId/directory` | `users:read` | People and groups for @-autocomplete |

`/users/me*` addresses the key's own identity: for a bot key that is the bot, so a key can set its
own status and presence without touching the admin who created it.

## Workspaces

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST/GET | `/workspaces` | `session` | Create, list memberships — outside any key's workspace binding |
| GET | `/workspaces/:id` | `workspace:read` | Workspace summary |
| GET | `/workspaces/:id/bootstrap` | `workspace:read` | Everything the client needs in one request |
| PATCH | `/workspaces/:id` | `workspace:write` | Settings; billing fields require owner |
| DELETE | `/workspaces/:id` | `admin:write` | Soft delete (owner) |
| GET | `/workspaces/:id/members` | `members:read` | `?includeRemoved=true` for admins |
| PATCH/DELETE | `/workspaces/:id/members/:memberId` | `members:write` | Role and status changes, removal |
| GET | `/workspaces/:id/usage` | `workspace:read` | Seats, pending invites, file count |
| GET | `/workspaces/:id/audit-events` | `admin:read` | Admin audit log |
| GET | `/workspaces/:id/exports` | `admin:read` | Export history |
| POST | `/workspaces/:id/exports` | `admin:write` | Queue an export job (owner) |
| POST | `/workspaces/:id/sections`, PATCH/DELETE `/sections/:id` | `workspace:write` | Sidebar sections |
| GET/POST | `/workspaces/:id/emoji`, DELETE `/emoji/:id` | `workspace:read` / `workspace:write` | Custom emoji |
| GET/POST | `/workspaces/:id/user-groups`, PATCH/DELETE `/user-groups/:id` | `workspace:read` / `workspace:write` | Mentionable groups |

## Invitations

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/invites` | `members:read` | Pending invitations |
| POST | `/workspaces/:id/invites` | `members:write` | Send email invites |
| POST | `/workspaces/:id/invite-links` | `members:write` | Reusable link with expiry and use limit |
| POST | `/invites/preview` | `public` | Workspace name for the invite screen |
| POST | `/invites/accept` | `session` | Joins, auto-joins default channels, notifies admins |
| POST | `/invites/:id/revoke`, `/invites/:id/resend` | `members:write` | Admin actions |

## Channels

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET/POST | `/workspaces/:id/channels` | `channels:read` / `channels:write` | Browser listing (`?q=`, `?includeArchived=`) and creation |
| GET/PATCH | `/channels/:id` | `channels:read` / `channels:write` | Details; topic/description open to members, name, posting policy, `autoJoin`, retention and private conversion are admin-only |
| POST | `/channels/:id/join`, `/leave`, `/archive`, `/unarchive` | `channels:write` | Membership and lifecycle |
| GET/POST | `/channels/:id/members`, DELETE `/channels/:id/members/:userId` | `channels:read` / `channels:write` | Member management |
| GET/POST | `/channels/:id/bookmarks`, DELETE `/bookmarks/:id` | `channels:read` / `channels:write` | Channel bookmark bar |

## Conversations and messages

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/conversations` | `conversations:read` | Sidebar payload with unread and mention counts |
| POST | `/conversations/dm` | `conversations:write` | Opens or reuses a DM / group DM |
| GET | `/conversations/:id` | `conversations:read` | Conversation, members and display label |
| GET | `/conversations/:id/messages` | `messages:read` | `?before=` / `?after=` ISO cursors, `?limit=` |
| POST | `/conversations/:id/messages` | `messages:write` | Sends, or runs a slash command |
| POST | `/conversations/:id/read`, `/unread` | `conversations:write` | Read state, mark unread from a message |
| PATCH | `/conversations/:id/membership` | `conversations:write` | Star, mute, notification level, section, hide |
| GET | `/conversations/:id/pins` | `messages:read` | Pinned messages |
| GET | `/conversations/:id/files` | `files:read` | Shared files |
| PUT | `/conversations/:id/draft` | `messages:write` | Upsert (empty body deletes) |
| POST | `/conversations/:id/scheduled` | `messages:write` | Schedule a send |
| POST | `/conversations/:id/typing` | `messages:write` | Typing signal (HTTP fallback for the socket) |
| GET/PATCH/DELETE | `/messages/:id` | `messages:read` / `messages:write` | Fetch, edit (author), delete (author or admin) |
| GET | `/messages/:id/thread` | `messages:read` | Root plus replies |
| POST/DELETE | `/messages/:id/reactions`, `/reactions/:emoji` | `messages:write` | Toggle reactions |
| POST/DELETE | `/messages/:id/pin` | `messages:write` | Pins |
| POST/DELETE | `/messages/:id/save` | `activity:write` | Saved items |
| POST | `/messages/:id/remind` | `activity:write` | Reminder from a message |
| POST | `/messages/:id/follow` | `messages:write` | `{ state: "following" \| "muted" }` for thread notifications |
| POST | `/messages/:id/share` | `messages:write` | Forward to a conversation or people |

Posting into a public channel joins it, exactly as it does in the UI, so a key with
`messages:write` does not need `channels:write` just to announce something.

## Integrations

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/channels/:id/webhooks` | `webhooks:read` | Incoming webhooks installed in a channel |
| POST | `/channels/:id/webhooks` | `webhooks:write` | Creates a bot identity and returns the URL **once** |
| DELETE | `/webhooks/:id` | `webhooks:write` | Revokes the webhook and removes its bot from the channel |
| POST | `/hooks/:webhookId/:token` | `public` | `{ "text": "Build #12 passed" }` posts as the bot |

```bash
curl -X POST "$WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -d '{"text":"Build *#1482* succeeded on `main` :rocket:"}'
```

A webhook is the one-line option for posting into a single channel. An API key is the general
one: every endpoint, scoped and rate limited per key.

## API keys

Full guide: **[API keys](api-keys.md)**. Admin or owner only.

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/api-keys` | `api_keys:read` | `?includeRevoked=true` for the full history |
| POST | `/workspaces/:id/api-keys` | `api_keys:write` | Returns the secret **once**; `identity: "bot" \| "self"` |
| GET/PATCH | `/api-keys/:id` | `api_keys:read` / `api_keys:write` | Inspect; rename, re-scope, re-limit, change expiry |
| POST | `/api-keys/:id/rotate` | `api_keys:write` | New secret, old one dies immediately |
| DELETE | `/api-keys/:id` | `api_keys:write` | Revoke |

## Discovery

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/meta` | `public` | Auth format, rate limits, links |
| GET | `/meta/routes` | `public` | Every route with its method, path, scope and access class |
| GET | `/meta/scopes` | `public` | The scope catalogue |
| GET | `/meta/openapi.json` | `public` | OpenAPI 3.1, generated from the table the server enforces |

## Files

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| POST | `/files` | `files:write` | `multipart/form-data`: `workspaceId`, optional `conversationId`, `file` |
| GET | `/files/:id/download` | `files:read` | Access-checked stream; images and PDFs inline, rest attachment |
| DELETE | `/files/:id` | `files:write` | Uploader or admin |

## Activity and search

| Method | Path | Scope | Notes |
| --- | --- | --- | --- |
| GET | `/workspaces/:id/search` | `messages:read` | `?q=` with operators, `?sort=recent\|relevant` |
| GET/POST | `/workspaces/:id/notifications`, `/notifications/read` | `activity:read` / `activity:write` | Activity feed |
| GET | `/workspaces/:id/threads` | `activity:read` | Threads you started or replied to |
| GET | `/workspaces/:id/saved` | `activity:read` | Saved items ("Later") |
| GET | `/workspaces/:id/drafts` | `activity:read` | Unsent drafts across conversations |
| GET | `/workspaces/:id/unreads` | `activity:read` | All unread messages grouped by conversation |
| GET | `/workspaces/:id/files` | `files:read` | Files across your conversations |
| GET | `/workspaces/:id/scheduled`, DELETE `/scheduled/:id` | `activity:read` / `activity:write` | Scheduled messages |
| GET/POST | `/workspaces/:id/reminders`, POST `/reminders/:id/complete` | `activity:read` / `activity:write` | Reminders |
| GET | `/commands` | any key | Slash command catalogue for autocomplete |

## Rate limits and errors

Errors are `{ "error": string, "code": string }`. Validation failures add `issues`.

Cookie traffic is limited per IP (600 requests/minute, tighter on credential endpoints). Key traffic
is limited per key — 120 requests/minute by default, 60 new messages/minute, a 40/second burst
ceiling and a 6000/minute ceiling across the whole workspace. Every key-authenticated response
carries `X-RateLimit-Limit`, `X-RateLimit-Remaining` and `X-RateLimit-Reset`; a `429` adds
`Retry-After`. Limits are per key and adjustable per key — see [API keys](api-keys.md).

## Message format

Message bodies are plain text with stable entity tokens:

```text
<@user-uuid>                  person mention
<#channel-uuid|name>          channel link
<!here> <!channel> <!everyone> broadcast
<!group:group-uuid|handle>    user group
<https://example.com|label>   labelled link
*bold* _italic_ ~strike~ `code` ```block``` > quote - list
```

`:shortcode:` renders a unicode emoji, or a workspace custom emoji image when one matches.
