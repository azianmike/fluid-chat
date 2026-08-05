# PRD: Fluid Chat — a free, open source chat alternative to Slack

## 1. Product summary

### Product name

**Fluid Chat**

Positioning line: *a free, open source chat alternative to Slack.*

### Product concept

A free, open source, self-hostable team chat product with Slack-like workspaces, channels, DMs, threads, search, notifications, and admin controls.

The business model is a hosted cloud version of the open-source product, positioned as a lower-cost alternative to Slack for small teams, startups, nonprofits, schools, agencies, and technical communities.

### Core promise

> A simple, reliable, affordable Slack alternative that teams can self-host for free or use as a low-cost hosted service.

---

# 2. Goals

## Product goals

1. Let teams create workspaces and communicate through channels, DMs, and threads.
2. Make the product easy to self-host with Docker Compose.
3. Make the hosted version cheap to operate and easy to monetize.
4. Provide enough Slack-like functionality for small teams to use daily.
5. Preserve trust through open-source availability and easy data export.

## Business goals

1. Offer hosted pricing meaningfully below Slack.
2. Maintain high gross margins through a simple, low-cost architecture.
3. Monetize convenience: hosting, backups, storage, upgrades, support, and business admin features.
4. Avoid expensive infrastructure dependencies in v1.

## Non-goals for v1

Do not build:

```text
Mobile apps
Voice/video
Slack import
Federation
E2E encryption
AI summaries/search
Plugin marketplace
Workflow builder
SAML/SCIM
Advanced compliance
Enterprise DLP
```

---

# 3. Target users

## Primary ICP

```text
Small startups
Developer teams
Agencies
Nonprofits
Schools
Open-source projects
Cost-sensitive Slack users
```

## User roles

### Workspace owner

Can:

```text
Create/delete workspace
Manage billing
Manage admins
Invite/remove users
Export data
Manage workspace settings
```

### Workspace admin

Can:

```text
Invite users
Remove users
Manage channels
Moderate messages
View audit logs
Configure workspace settings
```

### Member

Can:

```text
Join public channels
Send messages
Create channels if allowed
DM teammates
React to messages
Reply in threads
Search accessible messages
```

### Guest

Not in v1.

---

# 4. Product scope

## MVP features

```text
Signup/login
Workspace creation
Workspace switching
Email invites
Public/private channels
Channel joining/leaving
1:1 direct messages
Message sending
Message editing
Message deletion
Threads
Emoji reactions
Mentions
Unread indicators
Basic search
Basic notifications
Admin member management
Docker Compose self-hosting
Data export
```

## Post-MVP features

```text
Reusable invite links
Group DMs
File uploads
Custom domains
Guest users
Message retention controls
Advanced audit logs
SSO/SAML
SCIM
Slack import
Mobile apps
```

---

# 5. Core product principles

```text
Simple first, scalable later
Postgres as the source of truth
HTTP writes, WebSocket reads/events
Do not over-engineer v1
Every query is workspace-scoped
Self-hosting must be boring
Hosted version must be cheap to operate
Avoid lock-in; make export easy
```

---

# 6. User stories

## A. Workspace creation

### Story

As a new user, I want to create a workspace so my team can communicate in one shared place.

### Flow

```text
1. User signs up
2. User enters workspace name
3. System creates workspace
4. System creates default #general channel
5. User becomes owner
6. User lands in #general
7. App prompts user to invite teammates
```

### Acceptance criteria

```text
User can create a workspace after signup
Workspace has a unique slug
Owner membership is created
#general channel is created automatically
Owner is added to #general
Audit event is created
```

### Edge cases

```text
Workspace slug already taken
Invalid workspace name
User exceeds free workspace limit
Workspace creation fails midway
```

---

## B. Signup and login

### Story

As a user, I want to securely access my account and workspaces.

### MVP requirements

```text
Email/password signup
Email/password login
Logout
Password reset
Email verification
Server-side sessions
HttpOnly cookies
```

### Acceptance criteria

```text
User can create account
User can log in
User can log out
Session persists across refresh
User can reset password
Unverified email handling is defined
```

### Implementation notes

Use:

```text
Argon2 password hashing
HttpOnly secure cookies
CSRF protection
Rate limits on login/signup/password reset
```

---

## C. Inviting users

### Story

As an admin, I want to invite teammates so they can join the workspace.

### MVP flow

```text
1. Admin opens Invite people
2. Admin enters one or more emails
3. Admin chooses role: member or admin
4. System creates invite records
5. System sends invite emails
6. Recipient clicks invite link
7. Recipient signs up or logs in
8. System validates invite
9. System creates workspace membership
10. User joins #general
11. User lands in workspace
```

### Acceptance criteria

```text
Admins/owners can invite users by email
Members cannot invite unless setting allows it
Invites expire after 7 days
Invites can be revoked
Invites can be resent
Pending invites are visible to admins
Invite tokens are single-use
Invite tokens are stored hashed
Pending invites are not billable
Accepted users become billable on hosted plans
```

### Edge cases

```text
Invite expired
Invite revoked
Invite accepted twice
Invite sent to existing user
Invite sent to new user
Logged-in user email does not match invited email
User already member
User previously removed
Workspace seat limit reached
Email delivery failed
Duplicate pending invite
```

---

## D. Accepting an invite

### Story

As an invited user, I want to join a workspace with minimal friction.

### Flow: new user

```text
1. User clicks invite link
2. Invite preview page loads
3. User creates account
4. User verifies email if required
5. Invite is accepted
6. Workspace membership is created
7. User enters workspace
```

### Flow: existing user

```text
1. User clicks invite link
2. User logs in if needed
3. System confirms email match
4. Invite is accepted
5. User enters workspace
```

### Acceptance criteria

```text
Invite preview does not consume invite
Accepting invite is transactional
Wrong-email users cannot accept email-specific invites
Already-member users are redirected to workspace
Expired/revoked invites show clear error
```

---

## E. Creating channels

### Story

As a member, I want to create a channel for a specific topic or team.

### Flow

```text
1. User clicks Create channel
2. User enters channel name
3. User chooses public or private
4. User optionally adds description/topic
5. User optionally adds members
6. System creates channel
7. System creates conversation
8. Creator is added as member
9. Channel appears in sidebar
```

### Acceptance criteria

```text
User can create public channel if allowed
User can create private channel if allowed
Channel name is unique within workspace
Channel name is normalized
Private channels are invite-only
Public channels are discoverable
```

### Channel name rules

```text
Lowercase
Hyphens allowed
No spaces
Max 80 chars
Unique per workspace
```

### Edge cases

```text
Duplicate channel name
Invalid channel name
User lacks permission
Channel creation partially fails
Private channel leaks through search
```

---

## F. Joining and leaving channels

### Story

As a member, I want to browse and join public channels.

### Flow

```text
1. User opens channel browser
2. User sees public channels
3. User searches channels
4. User joins a channel
5. Channel appears in sidebar
```

### Acceptance criteria

```text
Public channels are visible in channel browser
Private channels are hidden from non-members
Members can join public channels
Members can leave non-required channels
Users cannot leave #general if configured as required
```

---

## G. Sending messages

### Story

As a user, I want to send messages in channels and DMs.

### Flow

```text
1. User types message
2. Client creates client_message_id
3. Client sends HTTP POST
4. Server validates permissions
5. Server writes message to Postgres
6. Server emits realtime event
7. Clients render message
```

### Acceptance criteria

```text
User can send message to conversations they belong to
Message appears immediately for sender
Message appears realtime for other users
Duplicate sends are prevented
Message is persisted before broadcast
Archived channels reject new messages
```

### Edge cases

```text
Connection drops mid-send
Client retries request
User removed from channel while composing
Message too long
Rate limit exceeded
Channel archived
Workspace disabled
```

### Implementation requirement

Use idempotency:

```text
client_message_id
unique(sender_id, client_message_id)
```

---

## H. Editing messages

### Story

As a user, I want to edit my message to fix mistakes.

### Acceptance criteria

```text
Author can edit own message
Edited message shows edited indicator
Edit updates all clients realtime
Deleted messages cannot be edited
```

### MVP data

```text
edited_at
```

Post-MVP:

```text
message_versions
```

---

## I. Deleting messages

### Story

As a user, I want to delete a message I sent.

### Acceptance criteria

```text
Author can delete own message
Admins can delete messages if moderation enabled
Deleted messages are soft-deleted
Deleted messages render as “This message was deleted”
Thread replies are not deleted when parent is deleted
```

### Data

```text
deleted_at
deleted_by_user_id
```

---

## J. Threads

### Story

As a user, I want to reply in a thread to keep side conversations organized.

### Flow

```text
1. User clicks Reply
2. Thread panel opens
3. User sends thread reply
4. Parent message shows reply count
5. Thread participants receive notification
```

### Acceptance criteria

```text
Any message can have thread replies
Thread replies are messages with parent_message_id
Parent message shows reply count
Parent message shows last reply timestamp
Thread participants can be notified
Deleted parent message does not delete replies
```

---

## K. Reactions

### Story

As a user, I want to react to messages with emoji.

### Acceptance criteria

```text
User can add emoji reaction
User can remove own reaction
Reaction counts update realtime
Users can see who reacted
One user can only apply same emoji once per message
```

### Constraint

```text
unique(message_id, user_id, emoji)
```

---

## L. Mentions

### Story

As a user, I want to mention teammates to get their attention.

### MVP mention types

```text
@user
```

### Post-MVP mention types

```text
@here
@channel
#channel
```

### Acceptance criteria

```text
Mentioned user receives notification
Mention is highlighted for recipient
Mention only works for users visible in workspace
Private channel mentions do not notify non-members
```

---

## M. Direct messages

### Story

As a user, I want to privately message a teammate.

### Flow

```text
1. User clicks New DM
2. User searches teammates
3. User selects teammate
4. Existing DM opens if present
5. Otherwise new DM conversation is created
6. User sends message
```

### Acceptance criteria

```text
Users can create 1:1 DMs
Duplicate DMs are not created
DMs appear in sidebar
DM messages are searchable only by participants
Removed users cannot receive new DMs
```

---

## N. Unreads and read state

### Story

As a user, I want to know which conversations have unread messages.

### Acceptance criteria

```text
Unread conversations are bolded
DMs show unread count
Mentions show badge count
Opening conversation marks it read
Read state syncs across devices
```

### Implementation

Do not create per-message read rows.

Use:

```text
conversation_members.last_read_message_id
conversation_members.last_read_at
```

---

## O. Search

### Story

As a user, I want to search old messages.

### MVP filters

```text
Keyword
Channel/conversation
Sender
Date range
```

### Acceptance criteria

```text
Search returns only accessible messages
Deleted messages are excluded
Private channel messages are hidden from non-members
DM messages are hidden from non-participants
Search results link back to message context
```

### Implementation

Use Postgres full-text search in v1.

---

## P. Notifications

### Story

As a user, I want to be notified when something needs my attention.

### MVP notification types

```text
DM
@mention
Thread reply
Invite accepted for admins
```

### Notification channels

```text
In-app
Email when inactive
```

### Acceptance criteria

```text
Notifications are created for DMs
Notifications are created for mentions
Notifications are created for thread replies
Notifications can be marked read
Email notifications are delayed/batched when possible
Muted conversations do not send notifications
```

---

## Q. Admin member management

### Story

As an admin, I want to manage workspace members.

### Acceptance criteria

```text
Admin can view members
Admin can invite users
Admin can remove users
Owner can promote/demote admins
Cannot remove last owner
Cannot demote last owner
Removed users lose access immediately
Removed users’ old messages remain visible
```

---

## R. Channel administration

### Story

As an admin, I want to manage channels.

### Acceptance criteria

```text
Admin can rename channels
Admin can edit topic/description
Admin can archive channels
Archived channels are read-only
Archived channels are hidden by default
Admins can unarchive channels
#general cannot be archived unless another default exists
```

---

## S. Data export

### Story

As a workspace owner, I want to export workspace data.

### MVP export format

```text
users.csv
channels.csv
messages.jsonl
reactions.jsonl
files_manifest.json
```

### Acceptance criteria

```text
Owner can request export
Export includes accessible workspace data
Export is generated asynchronously
Export expires after N days
Audit event is created
```

---

## T. Hosted billing

### Story

As a workspace owner, I want to manage hosted subscription and seats.

### Billing rules

```text
Pending invite: not billable
Active member: billable
Removed member: not billable
Suspended member: configurable, probably billable if seat reserved
Bot/system user: not billable
```

### Acceptance criteria

```text
Seat count updates when invite is accepted
Seat count decreases when user is removed
Workspace cannot exceed plan limits unless overage allowed
Failed payment enters grace period
Workspace becomes read-only after grace period
Workspace data is not immediately deleted
```

---

# 7. Functional requirements

## Workspace

```text
Create workspace
Update workspace name/logo
Switch workspaces
Delete workspace
Export workspace data
Manage workspace settings
```

## Auth

```text
Signup
Login
Logout
Password reset
Email verification
Session management
```

## Members

```text
Invite users
Accept invite
Revoke invite
Resend invite
List members
Change role
Remove member
Reinvite removed member
```

## Channels

```text
Create channel
List joined channels
Browse public channels
Join public channel
Leave channel
Rename channel
Archive channel
Create private channel
Add/remove private channel members
```

## Messages

```text
Send message
List messages
Edit message
Delete message
Reply in thread
React to message
Mention user
Search messages
```

## Notifications

```text
Create notification
List notifications
Mark notification read
Email inactive users
Mute conversation
```

## Admin

```text
View audit log
Manage members
Manage pending invites
Configure invite/channel permissions
View usage
```

---

# 8. Non-functional requirements

## Performance targets

MVP hosted target:

```text
100 concurrent users per workspace
10,000 messages per workspace
Sub-200ms normal API responses
Realtime delivery under 1 second
```

Near-term target:

```text
1,000 users per workspace
1M+ messages per workspace
Horizontal app scaling
Postgres remains primary database
```

## Availability

MVP:

```text
Best-effort self-hosted
Hosted target: 99.5%+
```

Later:

```text
99.9% for business plans
```

## Security

```text
Argon2 password hashing
HttpOnly secure cookies
CSRF protection
Rate limiting
Workspace-scoped authorization
Private channel access checks
Signed file URLs
Hashed invite tokens
Audit logs for admin actions
```

## Privacy

```text
Users can only access conversations they belong to
Search respects permissions
Private channels are not discoverable by non-members
DMs are only visible to participants
```

## Cost control

```text
No Elasticsearch in v1
No Kafka in v1
No AI by default
No video/audio
No per-message read receipts
No fanout notification rows for every channel message
Files/storage are quota-based
Email notifications are delayed/batched
```

---

# 9. Recommended stack

```text
Frontend/backend: Next.js + TypeScript
Database: PostgreSQL
ORM: Drizzle
Realtime: Socket.IO or ws
Cache/pubsub: Redis
Search: PostgreSQL full-text search
Files: S3-compatible storage / MinIO
Email: SES, Postmark, or Resend
Billing: Stripe
Deployment: Docker Compose for self-hosted
Monorepo: pnpm workspaces
```

## Why this stack

```text
Simple for self-hosting
Cheap for hosted operation
TypeScript end-to-end
Postgres handles core data and MVP search
Redis handles realtime/pubsub/rate limits
S3-compatible storage avoids lock-in
Docker Compose keeps install simple
```

---

# 10. System architecture

## MVP architecture

```text
Browser
  ↓ HTTP
Next.js app
  ↓
Postgres

Browser
  ↓ WebSocket
Realtime server
  ↓ Redis pub/sub
Other app instances

Background worker
  ↓
Email provider / export jobs / cleanup jobs
```

## Services

```text
app
postgres
redis
worker
object storage
```

Self-hosted:

```text
docker compose up
```

Hosted:

```text
app containers
managed Postgres
managed Redis
S3/R2 storage
email provider
Stripe
```

---

# 11. Data model

## users

```sql
users
- id uuid primary key
- email text unique not null
- email_verified_at timestamptz null
- password_hash text null
- display_name text not null
- avatar_url text null
- created_at timestamptz not null
- updated_at timestamptz not null
```

## workspaces

```sql
workspaces
- id uuid primary key
- name text not null
- slug text unique not null
- logo_url text null
- plan text not null default 'free'
- created_by_user_id uuid not null
- created_at timestamptz not null
- updated_at timestamptz not null
- deleted_at timestamptz null
```

## workspace_members

```sql
workspace_members
- id uuid primary key
- workspace_id uuid not null
- user_id uuid not null
- role text not null -- owner/admin/member
- status text not null -- active/removed/suspended
- joined_at timestamptz not null
- removed_at timestamptz null
- last_seen_at timestamptz null
- created_at timestamptz not null

unique(workspace_id, user_id)
```

## workspace_invites

```sql
workspace_invites
- id uuid primary key
- workspace_id uuid not null
- email text null
- role text not null
- token_hash text not null unique
- invite_type text not null -- email/link
- invited_by_user_id uuid not null
- max_uses int null
- use_count int not null default 0
- expires_at timestamptz not null
- accepted_at timestamptz null
- revoked_at timestamptz null
- created_at timestamptz not null
```

## channels

```sql
channels
- id uuid primary key
- workspace_id uuid not null
- name text not null
- description text null
- topic text null
- visibility text not null -- public/private
- auto_join boolean not null default false
- created_by_user_id uuid not null
- archived_at timestamptz null
- created_at timestamptz not null
- updated_at timestamptz not null

unique(workspace_id, name)
```

## conversations

```sql
conversations
- id uuid primary key
- workspace_id uuid not null
- type text not null -- channel/dm/group_dm
- channel_id uuid null
- created_at timestamptz not null
- updated_at timestamptz not null
```

## conversation_members

```sql
conversation_members
- id uuid primary key
- workspace_id uuid not null
- conversation_id uuid not null
- user_id uuid not null
- role text null
- last_read_message_id uuid null
- last_read_at timestamptz null
- muted_at timestamptz null
- joined_at timestamptz not null
- left_at timestamptz null

unique(conversation_id, user_id)
```

## messages

```sql
messages
- id uuid primary key
- workspace_id uuid not null
- conversation_id uuid not null
- sender_id uuid not null
- parent_message_id uuid null
- client_message_id text null
- body_text text not null
- body_json jsonb null
- edited_at timestamptz null
- deleted_at timestamptz null
- deleted_by_user_id uuid null
- created_at timestamptz not null

unique(sender_id, client_message_id)
```

## message_reactions

```sql
message_reactions
- id uuid primary key
- workspace_id uuid not null
- message_id uuid not null
- user_id uuid not null
- emoji text not null
- created_at timestamptz not null

unique(message_id, user_id, emoji)
```

## notifications

```sql
notifications
- id uuid primary key
- workspace_id uuid not null
- user_id uuid not null
- type text not null
- actor_user_id uuid null
- conversation_id uuid null
- message_id uuid null
- read_at timestamptz null
- created_at timestamptz not null
```

## audit_events

```sql
audit_events
- id uuid primary key
- workspace_id uuid not null
- actor_user_id uuid null
- type text not null
- entity_type text null
- entity_id uuid null
- metadata jsonb null
- created_at timestamptz not null
```

---

# 12. API design

## Auth

```http
POST /auth/signup
POST /auth/login
POST /auth/logout
POST /auth/forgot-password
POST /auth/reset-password
GET  /auth/me
```

## Workspaces

```http
POST /workspaces
GET  /workspaces
GET  /workspaces/:workspaceId
PATCH /workspaces/:workspaceId
DELETE /workspaces/:workspaceId
```

## Invites

```http
POST /workspaces/:workspaceId/invites
GET  /workspaces/:workspaceId/invites
POST /invites/preview
POST /invites/accept
POST /invites/:inviteId/resend
POST /invites/:inviteId/revoke
```

## Channels

```http
POST /workspaces/:workspaceId/channels
GET  /workspaces/:workspaceId/channels
GET  /channels/:channelId
PATCH /channels/:channelId
POST /channels/:channelId/join
POST /channels/:channelId/leave
POST /channels/:channelId/archive
POST /channels/:channelId/members
DELETE /channels/:channelId/members/:userId
```

## Conversations

```http
GET  /workspaces/:workspaceId/conversations
GET  /conversations/:conversationId
POST /conversations/dm
POST /conversations/:conversationId/read
```

## Messages

```http
GET    /conversations/:conversationId/messages
POST   /conversations/:conversationId/messages
PATCH  /messages/:messageId
DELETE /messages/:messageId
GET    /messages/:messageId/thread
```

## Reactions

```http
POST   /messages/:messageId/reactions
DELETE /messages/:messageId/reactions/:emoji
```

## Search

```http
GET /workspaces/:workspaceId/search?q=...
```

## Admin

```http
GET   /workspaces/:workspaceId/members
PATCH /workspaces/:workspaceId/members/:memberId
DELETE /workspaces/:workspaceId/members/:memberId
GET   /workspaces/:workspaceId/audit-events
```

---

# 13. Realtime events

## Event delivery model

```text
HTTP write
Postgres commit
Redis publish
WebSocket broadcast
Client update
```

## Events

```text
message.created
message.updated
message.deleted
reaction.created
reaction.deleted
conversation.read
channel.created
channel.updated
channel.archived
member.joined
member.removed
typing.started
typing.stopped
notification.created
```

## Rooms

```text
workspace:{workspaceId}
conversation:{conversationId}
user:{userId}
```

---

# 14. Permissions matrix

## Workspace permissions

| Action           | Owner |    Admin |   Member |
| ---------------- | ----: | -------: | -------: |
| Delete workspace |   Yes |       No |       No |
| Manage billing   |   Yes |       No |       No |
| Invite users     |   Yes |      Yes | Optional |
| Remove users     |   Yes |      Yes |       No |
| Change roles     |   Yes |  Limited |       No |
| Create channel   |   Yes |      Yes |      Yes |
| Export data      |   Yes | Optional |       No |

## Channel permissions

| Action        | Public member | Private member | Non-member |
| ------------- | ------------: | -------------: | ---------: |
| View metadata |           Yes |            Yes |         No |
| Read messages |     If joined |      If joined |         No |
| Send messages |     If joined |      If joined |         No |
| Join          |           Yes |    Invite-only |         No |
| Archive       |         Admin |          Admin |         No |

## Message permissions

| Action | Author | Admin | Other |
| ------ | -----: | ----: | ----: |
| Edit   |    Yes |    No |    No |
| Delete |    Yes |   Yes |    No |
| React  |    Yes |   Yes |   Yes |
| Reply  |    Yes |   Yes |   Yes |

---

# 15. Hosted pricing and packaging

## Open-source self-hosted

```text
Unlimited users
Unlimited messages
Core chat features
Community support
Manual upgrades
Self-managed storage/backups
```

## Hosted free

```text
Up to 5 users
Limited storage
Basic search
Community support
```

## Hosted Starter — target $2/user/month

```text
Unlimited message history
Basic admin
Email notifications
5 GB storage/workspace
Daily backups
```

## Hosted Team — target $3/user/month

```text
More storage
Custom domain
Priority support
Advanced admin controls
```

## Hosted Business — target $5/user/month

```text
SSO/SAML
SCIM
Audit logs
Compliance export
Retention policies
Higher storage
```

---

# 16. Self-hosting requirements

## Install

```bash
docker compose up
```

## Required components

```text
App
Postgres
Redis
Worker
Optional MinIO
```

## Required docs

```text
Install guide
Upgrade guide
Backup guide
Restore guide
SMTP configuration
S3/MinIO configuration
HTTPS/domain setup
Admin bootstrap
Environment variable reference
```

## Required scripts

```bash
scripts/backup.sh
scripts/restore.sh
scripts/migrate.sh
```

---

# 17. Build plan

## Phase 0: Foundation

```text
Monorepo setup
Next.js app
Postgres
Drizzle
Redis
Docker Compose
Auth/session system
Migrations
Basic UI shell
```

## Phase 1: Workspace

```text
Signup/login
Create workspace
Workspace switcher
Create #general
Workspace roles
Basic member table
```

## Phase 2: Channels and messages

```text
Create public/private channels
Join/leave channels
List channels
Send messages over HTTP
List message history
Edit/delete messages
```

## Phase 3: Realtime

```text
WebSocket server
Redis pub/sub
Message broadcast
Typing indicators
Reconnect handling
Optimistic UI
```

## Phase 4: Invites

```text
Email invite
Invite preview
Accept invite
Pending invites
Revoke invite
Resend invite
```

## Phase 5: DMs, threads, reactions

```text
1:1 DMs
Thread replies
Reply counts
Emoji reactions
Thread notifications
```

## Phase 6: Unreads, mentions, notifications

```text
Read cursors
Unread sidebar
@user mentions
In-app notifications
Inactive email notifications
```

## Phase 7: Search and export

```text
Postgres full-text search
Permission-scoped search
Workspace export
Audit log
```

## Phase 8: Hosted business layer

```text
Stripe billing
Seat counting
Plan limits
Storage limits
Usage dashboard
Automated backups
Admin billing page
```

---

# 18. Success metrics

## Product activation

```text
Workspace created
First channel created
First invite sent
First invite accepted
First 10 messages sent
3 active users in workspace
```

## Engagement

```text
Daily active workspaces
Messages sent per active workspace
DMs created
Threads created
Searches performed
Invite acceptance rate
```

## Business

```text
Free-to-paid conversion
Hosted workspace creation rate
Cost per active user
Gross margin
Churn
Expansion seats
```

## Reliability

```text
Message send success rate
Realtime delivery latency
API p95 latency
Email invite delivery rate
Error rate
```

---

# 19. Major risks

## Risk: generic Slack clone is hard to sell

Mitigation:

```text
Lead with lower cost
Lead with self-hosting
Lead with data ownership
Make migration/export easy
Focus on small teams first
```

## Risk: hosted margins get eaten by infra

Mitigation:

```text
Avoid Elasticsearch/Kafka
Use Postgres search first
Meter storage
Batch email notifications
Avoid AI/video/mobile early
```

## Risk: self-hosting support burden

Mitigation:

```text
Make install simple
Provide backup/restore scripts
Keep dependencies minimal
Publish clear upgrade docs
```

## Risk: realtime complexity

Mitigation:

```text
Use HTTP as source of truth
Use WebSockets only for events
Use Redis for fanout
Keep presence approximate in v1
```

---

# 20. Final recommendation

Build the v1 around this narrow promise:

> **A low-cost, open-source Slack alternative for small teams that need channels, DMs, threads, search, and reliable self-hosting — not enterprise bloat.**

The MVP should feel boring but dependable:

```text
Easy to install
Easy to invite teammates
Easy to send messages
Easy to find old messages
Easy to leave/export
Cheap to host
Cheap to operate