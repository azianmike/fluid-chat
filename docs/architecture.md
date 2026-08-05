# Architecture

## Processes

```text
next (app)     HTTP API + React client
realtime       Socket.IO server: authorizes rooms, relays events, tracks presence
worker         Background jobs: scheduled messages, reminders, exports, retention, email
postgres       Source of truth
redis          Optional. Only needed to fan out events across multiple app/realtime processes
```

Writes always go through the HTTP API. The realtime server never writes message data; it
authorizes room membership and relays events published by the app or worker.

## Request path

```text
/api/[...path]/route.ts
  └── handleApiRequest()                     src/server/index.ts
        ├── enforceCsrf / enforceRateLimit   src/lib/guards.ts
        ├── matchRoute()                     src/server/router.ts
        ├── API key path (Authorization: Bearer …)
        │     ├── resolveApiKey()            src/lib/api-auth.ts
        │     ├── assertRouteAllowed()       scope for this route spec
        │     └── enforceApiKeyRateLimit()   per-key budgets → X-RateLimit-* headers
        └── handler(ctx)                     src/server/routes/*.ts
              ├── ctx.user()                 session cookie or API key actor → users row
              ├── permission helpers         src/lib/permissions.ts
              └── services                   src/server/services/*.ts
```

An API key is a second credential for the same routes, not a second API. It resolves to a real
workspace member — a bot identity, or the admin who created it — which `ctx.user()` returns, so
handlers never branch on how the caller authenticated. Two extra invariants ride along the request
in an `AsyncLocalStorage` context: the key's scopes (checked once, against the route spec) and its
workspace (checked inside `requireWorkspaceMember`, which every workspace-scoped query already
passes through).

`src/lib/api-scopes.ts` maps every route spec to a scope, and `assertRoutesAreClassified` throws at
startup if a route is missing or stale. Adding an endpoint therefore forces a decision about who
may automate it.

Routes are declared as a map:

```ts
export const messageRoutes = defineRoutes({
  "PATCH /messages/:messageId": async (ctx) => { ... },
  "POST /messages/:messageId/pin": async (ctx) => { ... }
});
```

`compileRoutes` sorts static segments ahead of parameters, so `/conversations/dm` always wins
over `/conversations/:conversationId`. A handler returns a plain object (serialized as JSON), or
a `Response` when it needs to control status or stream bytes (file downloads).

## Permissions

| Helper | Guarantees |
| --- | --- |
| `requireWorkspaceMember` | Active membership in the workspace |
| `requireWorkspaceAdmin` / `requireWorkspaceOwner` | Role escalation checks |
| `resolveConversationAccess` | Read access: members, or any workspace member for public channels |
| `requireConversationMember` | Write access: actual membership required |
| `ensureConversationMembership` | Auto-joins a public channel when you post in a preview |

Every service call takes the workspace id from the row it loaded, never from the request body.

Guests are deliberately narrower than members: they see only the channels they were added to (no
public directory, no previewing, no self-serve joining), and cannot create channels, invite people
or install integrations. Everything else — messaging, threads, files, search within their
conversations — works normally.

## Realtime

Rooms are `user:<id>`, `workspace:<id>` and `conversation:<id>`. The realtime server verifies
membership in the database before a socket may join, so a forged room name yields nothing.

Events are a discriminated union (`RealtimeEvent` in `src/shared/types.ts`) delivered on a single
`event` channel, which keeps the client to one exhaustive switch:

```text
message.created / message.updated / message.deleted
reaction.changed / pin.changed
conversation.read / conversation.updated
typing / presence / user.updated
channel.created / channel.updated / member.changed
notification.created
```

Publishing (`src/lib/realtime.ts`) prefers Redis when `REDIS_URL` is set and otherwise POSTs the
event to the realtime server's `/publish` endpoint, guarded by `REALTIME_TOKEN`. Both paths are
fire-and-forget: a realtime outage degrades to refetching, it never fails a write.

## Data model highlights

- `conversations` unify channels, DMs and group DMs. `member_key` (sorted participant ids) plus a
  unique index makes duplicate DMs impossible under concurrency.
- Unread state lives on `conversation_members.last_read_at` — no per-message read rows.
- `messages.search_vector` is a generated `tsvector` with a GIN index; search filters are applied
  on top of membership joins so results never leak conversations you cannot see.
- Thread replies are `messages` with `parent_message_id`; they only appear in the main list when
  `thread_broadcast` is true.
- Files are rows in `files` that attach to a message on send, so an abandoned upload never leaks
  into a conversation.
- `thread_subscriptions` stores only explicit choices. Participation implies following, so the table
  stays small and "unfollow my own thread" still works.
- Incoming webhooks own a bot `users` row (`is_bot`), which is why their messages render with a name
  and an APP badge and why they hold no workspace seat. Only the token hash is stored.

## Background jobs

`src/server/jobs/index.ts` exports an array of `{ name, intervalMs, run }`. The worker runs each
on its own interval and logs failures without stopping the others. Jobs are idempotent, so more
than one worker can run at a time.

| Job | Interval | Purpose |
| --- | --- | --- |
| `scheduled-messages` | 15s | Deliver due scheduled messages |
| `reminders` | 20s | Fire reminders into the activity feed |
| `presence-decay` | 60s | Flip stale sessions to offline |
| `status-expiry` | 60s | Clear expired statuses and DND windows |
| `link-previews` | 30s | Unfurl links (opt-in via `ENABLE_LINK_UNFURL`, blocks private hosts) |
| `exports` / `export-expiry` | 30s / 5m | Build and expire workspace exports |
| `notification-emails` | 60s | Email unread mentions and DMs after 15 minutes |
| `billing-grace` | 5m | Move expired grace periods to read-only |
| `retention` | 1h | Delete messages past workspace or channel retention |

## Adding a feature

1. Add columns or tables to `src/db/schema.ts`, then `npm run db:generate && npm run db:migrate`.
2. Put the logic in a service under `src/server/services/` so jobs and routes can share it.
3. Add one line to the relevant route module.
4. Add the route to `ROUTE_ACCESS` in `src/lib/api-scopes.ts` — the server refuses to start
   otherwise. The new endpoint is then automatable with an API key on the same day it ships.
5. Extend the DTO in `src/shared/types.ts` and the client method in `src/client/api.ts`.
6. Render it — components read from the store and never fetch rows directly.
