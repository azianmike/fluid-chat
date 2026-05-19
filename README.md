# OpenChat

OpenChat is a self-hostable Slack-style team chat MVP built from `project-details.md`.

## Quick start

```bash
cp .env.example .env
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

For the self-hosted stack:

```bash
docker compose up
```

The app runs on `http://localhost:3000`. The optional realtime server runs on `http://localhost:3001`.

## MVP coverage

- Email/password signup, login, logout, HttpOnly session cookie, Argon2 password hashing.
- Workspace creation with unique slug, owner membership, default `#general`, conversation membership, and audit event.
- Public/private channels, join/leave, archive/unarchive, and member access checks.
- Messages with idempotent `client_message_id`, edit, soft delete, threads, reactions, unread cursors, muted notification checks, mentions, and Postgres full-text search.
- Invites with hashed single-use tokens, preview, accept, revoke, resend, expiry, and pending invite listing.
- Admin member management, audit log, notifications, and async export job records.
- Hosted plan primitives: seat limits, active/pending seat counting, billing grace/read-only state, and workspace usage endpoint.
- Docker Compose with app, Postgres, Redis, worker, realtime server, and optional MinIO.

## Docs

Self-hosting operations are documented in:

- [Install](docs/install.md)
- [Upgrade](docs/upgrade.md)
- [Backup](docs/backup.md)
- [Restore](docs/restore.md)
- [SMTP](docs/smtp.md)
- [S3 and MinIO](docs/s3-minio.md)
- [HTTPS and Domains](docs/https-domain.md)
- [Admin Bootstrap](docs/admin-bootstrap.md)
- [Billing and Usage](docs/billing.md)
- [Environment Variables](docs/env.md)
