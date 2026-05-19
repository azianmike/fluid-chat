# Restore Guide

Restore a SQL dump into an empty compatible Postgres database:

```bash
DATABASE_URL=postgres://openchat:openchat@localhost:5432/openchat scripts/restore.sh backups/openchat.sql
```

Restart the app and worker after restoring.
