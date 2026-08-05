# API keys

Fluid Chat has one HTTP surface. The web client calls it with a session cookie; scripts, CI jobs
and AI agents call the *same* endpoints with an API key. There is no second, smaller "public API"
to fall behind — if a person can do it in the UI, a key can do it, subject to the scopes it holds.

## Getting a key

Workspace **admins and owners** create keys in **Workspace settings → API keys**, or over the API:

```bash
curl -X POST "$APP_URL/api/workspaces/$WORKSPACE_ID/api-keys" \
  -H 'content-type: application/json' \
  -b "$SESSION_COOKIE" \
  -d '{
    "name": "Release bot",
    "identity": "bot",
    "botRole": "member",
    "scopes": ["messages:*", "channels:read"],
    "rateLimitPerMinute": 120,
    "messageLimitPerMinute": 60,
    "expiresInDays": 365
  }'
```

The response contains the secret **once**:

```json
{ "apiKey": { "id": "…", "prefix": "fluid_sk_A1b2c3", "scopes": ["messages:read", "messages:write", "channels:read"] },
  "token": "fluid_sk_A1b2c3…" }
```

Only a SHA-256 hash is stored. Lose the secret and you rotate it; there is no way to read it back.

### Identity: bot or self

| `identity` | Acts as | Use when |
| --- | --- | --- |
| `bot` (default) | A new bot user that appears in the member list and posts under its own name | Integrations, agents, anything whose messages should not look like they came from you |
| `self` | The admin who created the key | Personal automation — reading your own unreads, scripting your own workspace |

Bot identities hold a real workspace membership (`botRole`: `member` or `admin`), so the ordinary
permission rules apply to them. They do **not** consume a billable seat.

## Calling the API

```bash
curl "$APP_URL/api/auth/me" -H "Authorization: Bearer $FLUID_API_KEY"
```

`X-Api-Key: $FLUID_API_KEY` works too. Everything else is exactly the documented route surface —
see [the API reference](api.md).

```bash
# Post to a channel
curl -X POST "$APP_URL/api/conversations/$CONVERSATION_ID/messages" \
  -H "Authorization: Bearer $FLUID_API_KEY" \
  -H 'content-type: application/json' \
  -d '{"bodyText":"Deploy *v1.4.2* finished :rocket:"}'
```

```js
const fluid = (path, init = {}) =>
  fetch(`${process.env.APP_URL}/api${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${process.env.FLUID_API_KEY}`,
      "content-type": "application/json",
      ...init.headers
    }
  }).then((response) => response.json());

const { channels } = await fluid(`/workspaces/${workspaceId}/channels`);
const general = channels.find((channel) => channel.name === "general");
await fluid(`/channels/${general.id}/join`, { method: "POST" });
await fluid(`/conversations/${general.conversationId}/messages`, {
  method: "POST",
  body: JSON.stringify({ bodyText: "Standup in 5 minutes <!here>" })
});
```

## Scopes

A key holds an explicit list. `messages:*` grants a whole resource and `*` grants everything;
both are expanded and stored as concrete scopes, so a key's power never grows when new scopes ship.

| Scope | Covers |
| --- | --- |
| `messages:read` / `messages:write` | Read messages, threads, pins, search / post, edit, delete, react, pin, schedule, share, drafts, typing |
| `channels:read` / `channels:write` | Browse channels and members / create, edit, archive, join, leave, manage members and bookmarks |
| `conversations:read` / `conversations:write` | Sidebar and read state / open DMs, mark read/unread, star, mute, sections |
| `files:read` / `files:write` | List and download / upload and delete |
| `users:read` / `users:write` | Profiles and the mention directory / the key's own profile, status and presence |
| `workspace:read` / `workspace:write` | Settings, emoji, groups, sections / change them |
| `members:read` / `members:write` | Members and invitations / invite, change roles, remove |
| `activity:read` / `activity:write` | Notifications, saved, drafts, reminders, unreads / mark read, reminders, cancel scheduled |
| `webhooks:read` / `webhooks:write` | Incoming webhooks |
| `admin:read` / `admin:write` | Audit log and exports / request exports, delete the workspace |
| `api_keys:read` / `api_keys:write` | Manage API keys themselves |

Two rules on top of the scope check:

- **A key is pinned to one workspace.** Calling another workspace's data returns
  `403 workspace_scope_mismatch`, whatever the actor's other memberships are.
- **A key can never grant what it lacks.** Creating keys through a key is allowed with
  `api_keys:write`, but only for scopes the calling key already holds (`403 scope_escalation`).

### What keys cannot do

Credential management stays with signed-in humans: signup, login, logout, password change,
email verification, session listing and revocation, account deletion, accepting an invitation,
listing workspaces and creating one. These return `403 session_only`.

## Rate limits

Every response carries the current budget:

```text
X-RateLimit-Limit: 120
X-RateLimit-Remaining: 118
X-RateLimit-Reset: 1785904620
```

A `429` adds `Retry-After` (seconds) and a `code` naming the ceiling that fired:

| `code` | Ceiling | Default |
| --- | --- | --- |
| `rate_limited_burst` | Per key, per second | 40 |
| `rate_limited` | Per key, per minute | 120 (admin-configurable, max 6000) |
| `message_rate_limited` | New messages, scheduled sends, forwards and DM opens per key, per minute | 60 (admin-configurable) |
| `workspace_rate_limited` | All keys in a workspace, per minute | 6000 |

Message sends are metered separately from reads: a bot that reads a lot is cheap, a bot that posts
a lot is what spams people. Tune both numbers per key when you create or edit it.

## Rotation and revocation

```bash
curl -X POST "$APP_URL/api/api-keys/$KEY_ID/rotate" -H "Authorization: Bearer $ADMIN_KEY"   # new secret, old one dies immediately
curl -X DELETE "$APP_URL/api/api-keys/$KEY_ID" -H "Authorization: Bearer $ADMIN_KEY"        # revoke
```

Revoking a bot key that owns no other keys also retires its bot member. Both actions are recorded
in the workspace audit log (`api_key.created`, `api_key.rotated`, `api_key.revoked`), along with
each key's last-used time and request count.

A key also stops working the moment its actor is suspended or removed from the workspace
(`403 api_key_actor_inactive`), and when `expiresAt` passes (`401 api_key_expired`).

## Discovery for agents

Point an agent at these and it can learn the whole surface without reading this page:

| Endpoint | Returns |
| --- | --- |
| `GET /api/meta` | Auth header format, rate limits, links to the rest |
| `GET /api/meta/routes` | Every route with method, path, required scope and access class |
| `GET /api/meta/scopes` | The scope catalogue with descriptions |
| `GET /api/meta/openapi.json` | OpenAPI 3.1 document, generated from the same table the server enforces |

```bash
curl -s "$APP_URL/api/meta/routes" | jq '.routes[] | select(.scope == "messages:write")'
```

## Handling errors

Errors are `{ "error": string, "code": string }`. The codes worth branching on:

| Status | `code` | Meaning |
| --- | --- | --- |
| 401 | `invalid_api_key`, `api_key_revoked`, `api_key_expired` | The credential is not usable |
| 403 | `missing_scope` | Add the scope to the key |
| 403 | `workspace_scope_mismatch` | Wrong workspace for this key |
| 403 | `session_only` | Not available to keys by design |
| 403 | `api_key_actor_inactive` | The member behind the key was removed or suspended |
| 429 | see the table above | Back off until `Retry-After` |

## Keeping keys safe

- Treat a key like a password: environment variables or a secret manager, never a repository.
- Grant the narrowest scopes that work — start with `messages:write` rather than `*`.
- Set `expiresInDays` for anything temporary, and rotate on a schedule for anything long-lived.
- Give each integration its own key so revoking one does not take the others down.
- Serve the app over HTTPS in production; a bearer token in the clear is a bearer token lost.
