# TLS / HTTPS — Nginx snippet (F1.2)

Mount certificates under `deploy/ssl/` (see `docker-compose.yml` web service volumes).

## Example HTTPS server block

Replace the `listen 80` block in `deploy/nginx.conf` or add a second server:

```nginx
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate     /etc/nginx/ssl/fullchain.pem;
    ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;

    # Security headers (complement API helmet)
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    root /usr/share/nginx/html;
    index index.html;

    location /api/ {
        proxy_pass http://api:8080/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}

# Redirect HTTP → HTTPS
server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$host$request_uri;
}
```

## Checklist

1. Set `APP_URL=https://your-domain.com` in `.env` (CORS fallback + links).
2. Add production origin to **Platform Settings → Network → CORS origins** (or rely on `APP_URL` alone).
3. Ensure `JWT_SECRET` is ≥32 chars (API refuses weak default in `NODE_ENV=production`).
4. Optional rollback: `SECURITY_STRICT=false` relaxes rate limits / strict CORS / webhook enforcement only.
