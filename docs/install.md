# Install Guide

## Docker Compose

```bash
cp .env.example .env
docker compose up
```

The stack starts the Next.js app, Postgres, Redis, realtime server, worker, and optional MinIO.

## Local Development

```bash
npm install
npm run db:generate
npm run db:migrate
npm run dev
```

Use `npm run realtime` and `npm run worker` in separate terminals when testing realtime fanout and exports.
