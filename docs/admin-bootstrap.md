# Admin Bootstrap

The first workspace creator becomes the owner automatically.

Bootstrap flow:

1. Sign up.
2. Create a workspace.
3. The system creates owner membership, `#general`, and an audit event.
4. Invite admins from the workspace sidebar or `POST /api/workspaces/:workspaceId/invites`.

Never delete or demote the last owner; the API rejects both operations.
