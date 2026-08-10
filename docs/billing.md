# Billing and Usage

Fluid Chat keeps hosted billing state on the workspace record:

```text
plan
stripe_customer_id
subscription_status
seat_limit
storage_limit_bytes
overage_allowed
grace_period_ends_at
read_only_at
```

Owners can update billing fields through `PATCH /api/workspaces/:workspaceId`.
Admins can view usage through `GET /api/workspaces/:workspaceId/usage`.

Billing rules implemented in the MVP:

- Pending invites are counted separately and are not billable.
- Active members count toward the seat limit.
- Removed members do not count toward the seat limit.
- Invite acceptance is blocked when the active member count would exceed `seat_limit`, unless `overage_allowed` is true.
- Workspaces become read-only when `read_only_at` is in the past.
- The worker flips expired `grace_period` workspaces to `read_only`.
- Uploads are blocked when the workspace's live bytes plus the incoming file would
  exceed its storage limit, unless `overage_allowed` is true.

## Storage limits

Storage is the one resource that costs real money per byte held, so unlike seats it
has a default ceiling rather than an unlimited one.

The limit resolves in this order:

1. `workspaces.storage_limit_bytes` — per workspace, owner-settable through
   `PATCH /api/workspaces/:workspaceId`. `0` means unlimited.
2. `WORKSPACE_STORAGE_LIMIT_BYTES` — the deployment default when the column is
   `NULL`. `0` or unset-and-invalid means unlimited.
3. 50MB.

Only live bytes count: the sum of `files.size` where `deleted_at IS NULL`. Space is
returned when a file is deleted, when the message carrying it is deleted, when
retention removes old messages, and when the hourly `abandoned-uploads` job clears
uploads that were never posted. Custom emoji images and attachments waiting on a
pending scheduled message are never swept, since neither is attached to a message.

The check and the insert share a transaction guarded by a per-workspace advisory
lock, so concurrent uploads cannot each read the same pre-upload total and both pass.

Admins see current usage through `GET /api/workspaces/:workspaceId/usage`, which
reports `storageBytes` alongside the resolved `storageLimitBytes` (`null` = unlimited).

Stripe checkout, customer portal, and webhook handlers are intentionally left as hosted deployment integration points.
