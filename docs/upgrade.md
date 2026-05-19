# Upgrade Guide

1. Back up Postgres with `scripts/backup.sh`.
2. Pull the new application version.
3. Review `.env.example` for new variables.
4. Run `npm install` if dependencies changed.
5. Run `scripts/migrate.sh`.
6. Restart app, realtime, and worker services.

For Docker Compose deployments, rebuild after pulling:

```bash
docker compose build
docker compose up -d
```
