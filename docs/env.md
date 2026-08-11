# Environment Variables

`DATABASE_URL` is required. S3-compatible storage settings are also required to use file uploads
or workspace exports; Docker Compose supplies a local MinIO configuration.

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
S3_ENDPOINT               S3-compatible endpoint, such as the Cloudflare R2 S3 API endpoint.
S3_BUCKET                 Object storage bucket.
S3_ACCESS_KEY             Object storage access key.
S3_SECRET_KEY             Object storage secret key.
S3_REGION                 S3 region (default auto; use auto for Cloudflare R2).
S3_FORCE_PATH_STYLE       Set true for MinIO/providers that require path-style URLs.
```

Uploads are limited to 10MB each and 100MB of active files per workspace. They expire after 15
days. Both the API and worker enforce expiration, and the worker also sweeps the `files/` prefix
for orphaned objects. Workspace exports are stored in S3 and expire after 7 days. No runtime
upload or export data is written to local disk.

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
