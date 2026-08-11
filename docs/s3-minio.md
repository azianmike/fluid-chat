# File storage

Fluid Chat stores uploads and workspace exports in S3-compatible object storage. There is no
local-disk runtime driver or fallback.

## Cloudflare R2

Create a private R2 bucket and an API token with Object Read & Write access to that bucket, then
set:

```text
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_BUCKET=fluidchat
S3_ACCESS_KEY=<R2 access key ID>
S3_SECRET_KEY=<R2 secret access key>
S3_REGION=auto
S3_FORCE_PATH_STYLE=false
```

The app proxies downloads through `GET /api/files/:id/download`, so the bucket should remain
private and does not need a public URL or CORS policy.

New uploads use `files/<workspace-id>/...` object keys. The API stops returning a file at its exact
expiration time, the worker deletes expired database-backed objects every five minutes, and an
hourly prefix sweep deletes aged orphan objects whose database transaction never committed. The
sweep only needs the same Object Read & Write permission used for normal file operations; the app
does not modify bucket-level lifecycle configuration.

## Limits

- Maximum file size: 10MB (10 MiB).
- Maximum active file storage per workspace: 100MB (100 MiB).
- Upload retention: 15 days.
- Workspace export retention: 7 days.

Workspace quota checks are serialized in Postgres, so concurrent uploads cannot exceed the cap.
Expired and deleted files do not count toward quota.

## Migrating existing local uploads

Apply the database migration first, then copy legacy files to object storage:

```bash
npm run db:migrate
npm run storage:migrate-local
```

The first run uploads and verifies every object, updates its database storage key, and leaves the
local originals in place. After checking downloads, remove those verified originals with:

```bash
npm run storage:migrate-local -- --delete-local
```

The command only deletes exact migrated file paths. It does not recursively remove the uploads
directory.

## MinIO

Docker Compose supplies MinIO, creates the `fluidchat` bucket, and configures both the app and
worker. For a separate MinIO deployment, use its endpoint and credentials and set
`S3_FORCE_PATH_STYLE=true`.
