# Backup Guide

Set `DATABASE_URL`, then run:

```bash
scripts/backup.sh
```

The script writes SQL dumps to `backups/`.

Also back up file storage — by default the directory in `UPLOAD_DIR` (`./uploads`, or the
`uploads` volume under Docker Compose). Messages reference files by `storage_key`, so a database
restore without its uploads leaves attachments broken.

Workspace owners can additionally produce a portable export (JSONL + CSV + file manifest) from
**Workspace settings → Export**, which lands in `EXPORT_DIR`.
