# Install Guide

## Requirements

- Node.js 20+
- Postgres 14+
- Redis (optional — only needed when running more than one app or realtime process)

## Docker Compose

```bash
cp .env.example .env
docker compose up
```

The stack starts the Next.js app (which runs migrations on boot), Postgres, Redis, the realtime
server, the worker, and an optional MinIO. Uploads and exports live in named volumes.

Open http://localhost:3000, create an account, and the first workspace you create makes you its
owner with `#general` and `#random` ready to go.

## Local development

```bash
cp .env.example .env          # point DATABASE_URL at your Postgres
npm install
npm run db:migrate            # apply migrations
npm run dev                   # http://localhost:3000
npm run realtime              # second terminal: websockets on :3001
npm run worker                # third terminal: scheduled sends, reminders, exports
```

Create the database first if you need to:

```bash
createuser fluidchat --createdb
createdb -O fluidchat fluidchat
```

## Production

```bash
npm ci
npm run build
npm run db:migrate
npm run start          # app
npm run realtime       # websocket server
npm run worker         # background jobs
```

Put a TLS terminator in front (see [HTTPS and domains](https-domain.md)), set `APP_URL` and
`NEXT_PUBLIC_REALTIME_URL` to the public URLs, and set `REALTIME_TOKEN` so only your app can
publish events. Configure S3-compatible object storage for uploads and exports, and back up
Postgres (see [Backup](backup.md) and [S3 and MinIO](s3-minio.md)). Run the worker so scheduled
cleanup and orphaned-object sweeps remain active.

## After changing the schema

```bash
npm run db:generate    # writes a new migration into drizzle/
npm run db:migrate
```
