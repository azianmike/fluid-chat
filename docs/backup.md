# Backup Guide

Set `DATABASE_URL`, then run:

```bash
scripts/backup.sh
```

The script writes SQL dumps to `backups/`.

Also back up the configured S3-compatible bucket. Messages reference objects by `storage_key`, so
a database restore without its object storage leaves attachments broken.

Workspace owners can additionally produce a portable export (JSONL + CSV + file manifest) from
**Workspace settings → Export**, which is stored in the configured object bucket for 7 days.
