# Environment Variables

Only `DATABASE_URL` is required. Everything else has a working default for local development.

## Core

```text
DATABASE_URL              Postgres connection string.
APP_URL                   Public app URL, used for invite and verification links.
SESSION_SECRET            Reserved for cookie signing extensions; use at least 32 chars.
FREE_WORKSPACE_LIMIT      Max workspaces a user may own (0 or unset = unlimited).
```

## Realtime

```text
REDIS_URL                 Optional. Enables Redis pub/sub fan-out; required when running more
                          than one app or realtime process.
REALTIME_PORT             Port for the websocket server (default 3001).
REALTIME_INTERNAL_URL     Where the app posts events when Redis is not configured
                          (default http://localhost:3001).
REALTIME_TOKEN            Shared secret required by the realtime /publish endpoint.
NEXT_PUBLIC_REALTIME_URL  Websocket URL used by the browser (default http://localhost:3001).
```

## Files

```text
UPLOAD_DIR                Directory for uploaded files (default ./uploads).
UPLOAD_MAX_BYTES          Max size of a single upload in bytes (default 26214400 = 25MB).
WORKSPACE_STORAGE_LIMIT_BYTES
                          Total live bytes one workspace may store (default 52428800
                          = 50MB; 0 = unlimited). A workspace's storage_limit_bytes
                          column overrides this per workspace.
EXPORT_DIR                Directory for generated workspace exports (default ./exports).
S3_ENDPOINT               S3-compatible endpoint (for a future object-storage driver).
S3_BUCKET                 Object storage bucket.
S3_ACCESS_KEY             Object storage access key.
S3_SECRET_KEY             Object storage secret key.
```

## Email

```text
SMTP_HOST                 SMTP server host. When unset, emails are logged instead of sent and
                          password reset tokens are returned in the API response so first-run
                          setup can complete.
SMTP_PORT                 SMTP server port (default 587; 465 switches to TLS).
SMTP_USER                 SMTP username.
SMTP_PASSWORD             SMTP password.
SMTP_FROM                 Sender address.
```

## Optional features

```text
ENABLE_LINK_UNFURL        Set to "true" to let the worker fetch link previews. Private and
                          loopback hosts are always refused.
STRIPE_SECRET_KEY         Reserved for hosted billing integration.
```
