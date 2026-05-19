# S3 and MinIO Configuration

Docker Compose includes MinIO for S3-compatible storage:

```text
S3_ENDPOINT=http://minio:9000
S3_BUCKET=openchat
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
```

File uploads are post-MVP in the PRD, but these variables reserve the storage path for hosted and self-hosted deployments.
