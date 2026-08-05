# HTTPS and Domain Setup

Put Fluid Chat behind a reverse proxy such as Caddy, Nginx, or Traefik.

Required behavior:

- Terminate TLS at the proxy.
- Forward `Host`, `X-Forwarded-Proto`, and `X-Forwarded-For`.
- Route app traffic to port `3000`.
- Route realtime Socket.IO traffic to port `3001` if hosted separately.
- Set `APP_URL=https://chat.example.com`.

Use secure cookies in production by running with `NODE_ENV=production`.
