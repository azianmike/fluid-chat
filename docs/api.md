# API reference

Every endpoint lives under `/api`. Requests and responses are JSON (file upload and download are
the exceptions). Authentication is a `HttpOnly` session cookie; mutating requests are origin
checked and rate limited. Errors return `{ "error": string, "code": string }` with a matching
status.

Print the live route table any time with:

```bash
npx tsx -e "import('./src/server/index.ts').then(m => console.log(m.routeTable.sort().join('\n')))"
```

## Auth and account

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/auth/signup` | Creates the user, session and email verification token |
| POST | `/auth/login` | Email + password |
| POST | `/auth/logout` | Clears the session |
| GET | `/auth/me` | Current user and workspace memberships |
| POST | `/auth/forgot-password` | Always 200; returns the token only when SMTP is unset |
| POST | `/auth/reset-password` | Consumes the token and revokes all sessions |
| POST | `/auth/change-password` | Requires the current password |
| POST | `/auth/verify-email`, `/auth/resend-verification` | Email verification |
| GET/DELETE | `/auth/sessions`, `/auth/sessions/:sessionId` | Device list and revocation |
| DELETE | `/auth/account` | Closes an account that owns no workspaces |

## Users and presence

| Method | Path | Notes |
| --- | --- | --- |
| PATCH | `/users/me` | Name, handle, title, pronouns, phone, timezone, avatar |
| PATCH | `/users/me/preferences` | Theme, density, notifications, keywords, skin tone |
| PUT | `/users/me/status` | Emoji, text, optional expiry |
| PUT | `/users/me/presence` | `active` / `away` / `dnd` / `offline` (+ `dndUntil`) |
| POST | `/users/me/heartbeat` | Keeps presence fresh; called by the client every minute |
| GET | `/users/:userId` | Profile, restricted to shared workspaces |
| GET | `/workspaces/:workspaceId/directory` | People and groups for @-autocomplete |

## Workspaces

| Method | Path | Notes |
| --- | --- | --- |
| POST/GET | `/workspaces` | Create, list memberships |
| GET | `/workspaces/:id` | Workspace summary |
| GET | `/workspaces/:id/bootstrap` | Everything the client needs in one request |
| PATCH | `/workspaces/:id` | Settings; billing fields require owner |
| DELETE | `/workspaces/:id` | Soft delete (owner) |
| GET | `/workspaces/:id/members` | `?includeRemoved=true` for admins |
| PATCH/DELETE | `/workspaces/:id/members/:memberId` | Role and status changes, removal |
| GET | `/workspaces/:id/usage` | Seats, pending invites, file count |
| GET | `/workspaces/:id/audit-events` | Admin audit log |
| POST/GET | `/workspaces/:id/exports` | Queue and list export jobs (owner) |
| POST | `/workspaces/:id/sections`, PATCH/DELETE `/sections/:id` | Sidebar sections |
| GET/POST | `/workspaces/:id/emoji`, DELETE `/emoji/:id` | Custom emoji |
| GET/POST | `/workspaces/:id/user-groups`, PATCH/DELETE `/user-groups/:id` | Mentionable groups |

## Invitations

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/workspaces/:id/invites` | List and send email invites |
| POST | `/workspaces/:id/invite-links` | Reusable link with expiry and use limit |
| POST | `/invites/preview` | Public: workspace name for the invite screen |
| POST | `/invites/accept` | Joins, auto-joins default channels, notifies admins |
| POST | `/invites/:id/revoke`, `/invites/:id/resend` | Admin actions |

## Channels

| Method | Path | Notes |
| --- | --- | --- |
| GET/POST | `/workspaces/:id/channels` | Browser listing (`?q=`, `?includeArchived=`) and creation |
| GET/PATCH | `/channels/:id` | Details; topic/description open to members, name, posting policy, `autoJoin`, retention and private conversion are admin-only |
| POST | `/channels/:id/join`, `/leave`, `/archive`, `/unarchive` | Membership and lifecycle |
| GET/POST | `/channels/:id/members`, DELETE `/channels/:id/members/:userId` | Member management |
| GET/POST | `/channels/:id/bookmarks`, DELETE `/bookmarks/:id` | Channel bookmark bar |

## Conversations and messages

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/workspaces/:id/conversations` | Sidebar payload with unread and mention counts |
| POST | `/conversations/dm` | Opens or reuses a DM / group DM |
| GET | `/conversations/:id` | Conversation, members and display label |
| GET | `/conversations/:id/messages` | `?before=` / `?after=` ISO cursors, `?limit=` |
| POST | `/conversations/:id/messages` | Sends, or runs a slash command |
| POST | `/conversations/:id/read`, `/unread` | Read state, mark unread from a message |
| PATCH | `/conversations/:id/membership` | Star, mute, notification level, section, hide |
| GET | `/conversations/:id/pins`, `/files` | Pinned messages, shared files |
| PUT | `/conversations/:id/draft` | Upsert (empty body deletes) |
| POST | `/conversations/:id/scheduled` | Schedule a send |
| POST | `/conversations/:id/typing` | Typing signal (HTTP fallback for the socket) |
| GET/PATCH/DELETE | `/messages/:id` | Fetch, edit (author), delete (author or admin) |
| GET | `/messages/:id/thread` | Root plus replies |
| POST/DELETE | `/messages/:id/reactions`, `/reactions/:emoji` | Toggle reactions |
| POST/DELETE | `/messages/:id/pin`, `/save` | Pins and saved items |
| POST | `/messages/:id/remind` | Reminder from a message |
| POST | `/messages/:id/follow` | `{ state: "following" \| "muted" }` for thread notifications |
| POST | `/messages/:id/share` | Forward to a conversation or people |

## Integrations

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/channels/:id/webhooks` | Incoming webhooks installed in a channel |
| POST | `/channels/:id/webhooks` | Creates a bot identity and returns the URL **once** |
| DELETE | `/webhooks/:id` | Revokes the webhook and removes its bot from the channel |
| POST | `/hooks/:webhookId/:token` | Public: `{ "text": "Build #12 passed" }` posts as the bot |

```bash
curl -X POST "$WEBHOOK_URL" \
  -H 'content-type: application/json' \
  -d '{"text":"Build *#1482* succeeded on `main` :rocket:"}'
```

## Files

| Method | Path | Notes |
| --- | --- | --- |
| POST | `/files` | `multipart/form-data`: `workspaceId`, optional `conversationId`, `file` |
| GET | `/files/:id/download` | Access-checked stream; images and PDFs inline, rest attachment |
| DELETE | `/files/:id` | Uploader or admin |

## Activity and search

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/workspaces/:id/search` | `?q=` with operators, `?sort=recent\|relevant` |
| GET/POST | `/workspaces/:id/notifications`, `/notifications/read` | Activity feed |
| GET | `/workspaces/:id/threads` | Threads you started or replied to |
| GET | `/workspaces/:id/saved` | Saved items ("Later") |
| GET | `/workspaces/:id/drafts` | Unsent drafts across conversations |
| GET | `/workspaces/:id/unreads` | All unread messages grouped by conversation |
| GET | `/workspaces/:id/files` | Files across your conversations |
| GET | `/workspaces/:id/scheduled`, DELETE `/scheduled/:id` | Scheduled messages |
| GET/POST | `/workspaces/:id/reminders`, POST `/reminders/:id/complete` | Reminders |
| GET | `/commands` | Slash command catalogue for autocomplete |

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
