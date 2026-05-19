# SMTP Configuration

OpenChat stores invite and reset tokens immediately. Wire these variables to an SMTP provider before enabling real outbound mail:

```text
SMTP_HOST
SMTP_PORT
SMTP_USER
SMTP_PASSWORD
SMTP_FROM
```

The MVP API returns preview/reset/invite tokens in responses for local self-hosted testing.

The worker also sends delayed email notifications for unread in-app notifications when SMTP is configured.
