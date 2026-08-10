# File storage

Uploads are handled by a small storage driver (`src/server/services/storage.ts`) with three
operations: `putObject`, `objectStream`, `deleteObject`.

## Local disk (default)

```text
UPLOAD_DIR=./uploads                    # or /app/uploads in Docker
UPLOAD_MAX_BYTES=26214400               # 25MB, one file
WORKSPACE_STORAGE_LIMIT_BYTES=52428800  # 50MB, one workspace in total
```

Files are written to `UPLOAD_DIR/<workspace-id>/<uuid>-<name>` and served through
`GET /api/files/:id/download`, which checks conversation access on every request, sends
`X-Content-Type-Options: nosniff`, and forces a download for anything that is not an image or PDF.
Back this directory up alongside Postgres.

## Quotas

Two ceilings apply to every upload, both enforced in `uploadFile`:

- `UPLOAD_MAX_BYTES` rejects a single oversized file with `413 file_too_large`.
- The workspace total rejects with `402 storage_limit_reached`. See
  [billing.md](billing.md) for how the limit resolves and what frees space again.

Deleting a file, deleting the message that carried it, and retention all release
the bytes as well as the row, and an hourly job drops uploads that were never
posted. Storage a workspace can no longer see is storage it no longer pays for.

## S3 or MinIO

Docker Compose includes MinIO for S3-compatible storage:

```text
S3_ENDPOINT=http://minio:9000
S3_BUCKET=fluidchat
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

To move storage off local disk, implement the same three functions against your SDK of choice and
export them from `storage.ts`. Nothing else in the codebase touches the filesystem, and stored
`storage_key` values stay valid because they are opaque to the rest of the app.
