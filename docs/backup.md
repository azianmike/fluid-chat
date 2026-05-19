# Backup Guide

Set `DATABASE_URL`, then run:

```bash
scripts/backup.sh
```

The script writes SQL dumps to `backups/`. Back up object storage separately if file uploads are enabled in a later release.
