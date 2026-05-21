# Deployment Guide

This platform is fully self-hosted — no Clerk, no external auth services.
Authentication uses bcrypt + JWT stored in localStorage.

## Prerequisites

- Docker + Docker Compose **or** Node.js 24 + PM2 + Nginx (bare metal)
- PostgreSQL 15+
- Optional: SMTP server for invitation emails

---

## Option A — Docker Compose (recommended)

```bash
# 1. Clone the repo
git clone https://your-repo/ops-platform && cd ops-platform

# 2. Create environment file
cp .env.example .env
# Edit .env — set JWT_SECRET, DATABASE_URL, APP_URL

# 3. Start services
docker compose -f deploy/docker-compose.yml up -d

# 4. Run DB migrations
docker compose -f deploy/docker-compose.yml exec api \
  pnpm --filter @workspace/db run push

# 5. Create the platform super-admin
docker compose -f deploy/docker-compose.yml exec api \
  pnpm --filter @workspace/scripts run setup-owner
```

---

## Option B — Bare Metal (PM2 + Nginx)

### 1. Install dependencies
```bash
corepack enable && corepack prepare pnpm@latest --activate
pnpm install --frozen-lockfile
```

### 2. Build
```bash
pnpm run typecheck:libs
pnpm --filter @workspace/api-server run build
pnpm --filter @workspace/ops-platform run build
```

### 3. Push DB schema
```bash
pnpm --filter @workspace/db run push
```

### 4. Create super-admin
```bash
pnpm --filter @workspace/scripts run setup-owner
```

### 5. Start API with PM2
```bash
pm2 start deploy/ecosystem.config.cjs --env-file .env
pm2 save && pm2 startup
```

### 6. Configure Nginx
```bash
# Copy built frontend
sudo cp -r artifacts/ops-platform/dist /var/www/ops-platform

# Copy nginx config
sudo cp deploy/nginx.conf /etc/nginx/sites-available/ops-platform
sudo ln -s /etc/nginx/sites-available/ops-platform /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret for signing JWTs (use `openssl rand -hex 64`) |
| `JWT_EXPIRES_IN` | ❌ | Token lifetime, default `24h` |
| `SESSION_SECRET` | ✅ | Session signing secret |
| `APP_URL` | ✅ | Public URL (e.g. `https://ops.company.com`) |
| `PORT` | ❌ | API server port, default `8080` |
| `SMTP_HOST` | ❌ | SMTP host for invitation emails |
| `SMTP_PORT` | ❌ | SMTP port, default `587` |
| `SMTP_USER` | ❌ | SMTP username |
| `SMTP_PASS` | ❌ | SMTP password |
| `SMTP_FROM` | ❌ | From address |
| `SMTP_SECURE` | ❌ | Use TLS, default `false` |

---

## User Management

Since there is no public sign-up:

1. **Platform owner** — created once with `pnpm --filter @workspace/scripts run setup-owner`
2. **Workspace admins** — created by super-admin via the Super Admin panel
3. **Workspace users** — created by workspace admins via Users → Create User (with password)

All passwords are hashed with bcrypt (cost factor 12). Users sign in with their **Employee Number** + password.

---

## HTTPS (Production)

For Nginx with Let's Encrypt:
```bash
sudo certbot --nginx -d ops.company.com
```

The nginx.conf in `deploy/` already includes the correct proxy headers.
