# OpenChat

A self-hostable Slack alternative: channels, direct messages, threads, reactions, files,
search, presence and a realtime UI — built on Next.js, Postgres and a small Socket.IO server.

![stack](https://img.shields.io/badge/stack-Next.js%2015%20·%20Postgres%20·%20Drizzle%20·%20Socket.IO-informational)

## Quick start

```bash
cp .env.example .env
npm install
npm run db:generate   # only after changing src/db/schema.ts
npm run db:migrate
npm run dev           # app on http://localhost:3000
```

In two more terminals (both optional but recommended):

```bash
npm run realtime      # websocket fan-out on :3001
```

```bash
npm run worker        # scheduled messages, reminders, exports, retention, email
```

Postgres is the only hard dependency. Redis is optional: with `REDIS_URL` set the realtime
server fans out through Redis pub/sub (needed for more than one app process); without it the
app posts events straight to the realtime server over HTTP.

For the full stack in containers:

```bash
docker compose up
```

## Features

**Messaging**
- Public and private channels, archived channels, channel browser, join/leave, previews of public channels
- 1:1 direct messages and group DMs (up to 9 people) with a deterministic member key — no duplicate conversations
- Threads with reply counts, participant facepiles, and "also send to channel" broadcasts
- Message editing, soft deletion, idempotent sends (`clientMessageId`) and optimistic rendering
- Formatting: `*bold*`/`**bold**`, `_italic_`, `~strike~`, `` `code` ``, code fences, quotes, lists, links
- Mentions of people (`@ada`), groups, `@here`/`@channel`/`@everyone`, and channel links (`#design`)
- Emoji reactions with a full picker, skin tones, frequently used and workspace custom emoji
- File uploads with drag-and-drop, paste, inline image rendering and per-conversation file lists
- Pins, saved items ("Later"), message sharing/forwarding, permalinks, reminders, scheduled send
- Thread following: taking part follows automatically, and you can follow or mute any thread explicitly
- Incoming webhooks so CI, alerts or scripts post into a channel under their own app identity
- Slash commands: `/me /shrug /topic /purpose /rename /invite /join /leave /archive /msg /remind /dnd /away /active /status /mute /unmute /who /help`

**Navigation and awareness**
- Unread counts, mention badges, "New messages" divider, mark unread from any message
- Activity feed (mentions, thread replies, reactions, keyword highlights), Threads view, All unreads, Later, Drafts & sent, Files, People
- Quick switcher (⌘K), keyboard shortcuts (⌘/), ↑ to edit your last message, deep-linkable permalinks
- Presence (active/away/DND/offline) with heartbeats, custom status with expiry, typing indicators per composer
- Sidebar starring, muting, per-conversation notification levels, custom sections, drafts indicators
- Workspace rail for switching tenants, and a drawer layout that makes the whole app usable on a phone

**Search**
- Postgres full-text search with `in:#channel`, `from:@person`, `has:file`, `has:link`, `is:pinned`, `before:`, `after:`, `during:` operators, sorted by recency or relevance

**Administration**
- Roles (owner/admin/member/guest), member management, seat limits and billing state
- Guests are scoped to the channels they are added to and cannot browse, join, invite or integrate
- Email invitations and reusable invite links with expiry and use limits
- Workspace settings, channel management, custom emoji, user groups, audit log
- Per-channel controls: posting policy, default (auto-join) channels, retention, private conversion, integrations
- Data export (JSONL + CSV + file manifest), message retention policies, per-workspace read-only mode

**Preferences**
- Light and dark themes (or match the OS), comfortable/compact density, 12h/24h clocks
- Enter-to-send toggle, notification levels, highlight keywords, desktop notifications, sounds, session management
- Notification schedule (quiet hours) evaluated in your own timezone, honored by sounds, desktop alerts and email

## Deliberately not built

These are real Slack features that need infrastructure or scope beyond a self-hosted chat server.
They are called out here rather than half-implemented:

| Feature | Why not |
| --- | --- |
| Huddles, voice and video calls | Needs SFU/WebRTC media infrastructure |
| Canvas and lists | A collaborative document editor is its own product |
| Workflow Builder | Needs a visual automation runtime; webhooks cover the common cases |
| Slack Connect (shared channels across orgs) | Requires federation between deployments |
| SSO/SAML, SCIM provisioning, Enterprise Grid | Enterprise identity integrations; the schema leaves room for them |
| Native mobile apps | The web client is responsive and works on a phone |

## Architecture

```text
src/
  app/            Next.js routes; /api/[...path] is a thin adapter over the server router
  server/
    router.ts     Tiny pattern router: "METHOD /path/:param" → handler, with a typed Context
    routes/       One module per domain (auth, users, workspaces, invites, channels,
                  conversations, messages, files, activity) — the whole HTTP surface
    services/     Reusable domain logic shared by routes, jobs and the realtime server
    jobs/         Background jobs (scheduled sends, reminders, retention, exports, email)
  client/
    api.ts        Typed API client, one method per endpoint
    store.tsx     App state, actions and realtime wiring in a single provider
    components/   UI: shell, message list, composer, panels, views, modals
  shared/         Types and the message format shared by client and server
  realtime/       Socket.IO server: room authorization, presence, typing, event relay
  db/             Drizzle schema and client
```

Design rules that keep it extensible:

- **Every query is workspace-scoped.** Permission helpers (`requireWorkspaceMember`,
  `resolveConversationAccess`) are the only way into data.
- **Writes go over HTTP, reads and events over WebSocket.** Realtime is an accelerator; if it is
  down the app still works.
- **One line per endpoint.** Adding a feature means adding a route entry and a service function.
- **Messages are plain text with stable entity tokens** (`<@uuid>`, `<#uuid|name>`, `<!here>`), so
  renames never rewrite history and exports stay greppable.
- **The client renders from DTOs**, never raw rows, so the wire format is a deliberate contract
  (`src/shared/types.ts`).

## Scripts

```bash
npm run dev         # Next.js dev server
npm run build       # production build
npm run start       # production server
npm run realtime    # websocket server
npm run worker      # background jobs
npm run test        # vitest unit suite
npm run typecheck   # tsc --noEmit
npm run db:generate # generate a migration from schema changes
npm run db:migrate  # apply migrations
```

## Docs

- [Install](docs/install.md)
- [Architecture](docs/architecture.md)
- [API reference](docs/api.md)
- [Environment variables](docs/env.md)
- [Upgrade](docs/upgrade.md) · [Backup](docs/backup.md) · [Restore](docs/restore.md)
- [SMTP](docs/smtp.md) · [S3 and MinIO](docs/s3-minio.md) · [HTTPS and domains](docs/https-domain.md)
- [Admin bootstrap](docs/admin-bootstrap.md) · [Billing and usage](docs/billing.md)
