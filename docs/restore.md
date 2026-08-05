# Restore Guide

Restore a SQL dump into an empty compatible Postgres database:

```bash
DATABASE_URL=postgres://fluidchat:fluidchat@localhost:5432/fluidchat scripts/restore.sh backups/fluidchat.sql
```

Restart the app and worker after restoring.
