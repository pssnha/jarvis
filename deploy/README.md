# Deploying Jarvis to a Hostinger VPS

Target: a Hostinger **VPS** (Ubuntu 22.04/24.04 LTS recommended) running the stack with Docker
Compose behind Nginx + Let's Encrypt.

## 1. Prepare the VPS

```bash
# As root (or with sudo) on the VPS:
apt update && apt -y upgrade
apt -y install docker.io docker-compose-plugin git
systemctl enable --now docker
```

Point your domain's **DNS A record** at the VPS public IP. Decide whether the API/webhook live at
`/api` on the same host (default — already wired in `deploy/nginx/default.conf`) or on an `api.`
subdomain (add a second A record + server block if so).

## 2. Get the code and configure

```bash
git clone <YOUR_REPO_URL> jarvis && cd jarvis
cp .env.example .env
# Edit .env — set strong MYSQL_PASSWORD / MYSQL_ROOT_PASSWORD, ANTHROPIC_API_KEY,
# all WHATSAPP_* values, and:
#   DATABASE_URL="mysql://jarvis:<MYSQL_PASSWORD>@mysql:3306/jarvis"
#   PUBLIC_WEB_ORIGIN="https://YOUR_DOMAIN"
```

> Note: inside Docker, the DB host is `mysql` and Redis is `redis` (service names), not
> `localhost`.

## 3. First boot (HTTP only)

```bash
docker compose up -d --build
docker compose exec api pnpm --filter @jarvis/db migrate:deploy   # apply migrations
```

Verify: `http://YOUR_DOMAIN/api/healthz` returns `{"status":"ok",...}`.

## 4. Issue a TLS certificate

```bash
docker compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  -d YOUR_DOMAIN \
  --email YOUR_EMAIL --agree-tos --no-eff-email
```

Then edit `deploy/nginx/default.conf`: uncomment the `443` server block, set `YOUR_DOMAIN`, and
change the port-80 `location /` to `return 301 https://$host$request_uri;` (keep the
`acme-challenge` location on port 80). Reload:

```bash
docker compose restart nginx
```

The bundled `certbot` service auto-renews every 12h; `nginx` picks up renewed certs on restart.

## 5. Register the WhatsApp webhook

In the Meta app dashboard, set the callback URL to `https://YOUR_DOMAIN/api/whatsapp/webhook`, enter
your `WHATSAPP_VERIFY_TOKEN`, and subscribe to the **messages** field. Meta will call the `GET`
endpoint once to verify, then deliver inbound messages to the `POST` endpoint.

## 6. Telegram (alternative to WhatsApp groups)

A single shared bot serves every circle — no phone number, no per-circle session.

1. Create a bot with **@BotFather** → copy the token.
2. **Disable privacy mode**: BotFather → `/setprivacy` → select the bot → **Disable**. Otherwise the
   bot only receives `/commands`, @mentions, and replies — not the natural group messages the agent
   needs. (Making the bot a group admin also works.)
3. Set env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` (any random string), and
   `TELEGRAM_BOT_USERNAME` (for the deep links shown in the dashboard).
4. The API registers the webhook automatically on boot
   (`https://YOUR_DOMAIN/api/telegram/webhook`, guarded by the secret-token header).
5. In the app: a circle admin opens **Connections → Telegram**, clicks Connect to get a code, adds
   the bot to a Telegram group, and sends `/link <code>` there to bind the group.

## Updating

```bash
git pull
docker compose up -d --build
docker compose exec api pnpm --filter @jarvis/db migrate:deploy
```

## Lighter alternative (no Docker)

For a minimal footprint you can instead install Node 22, MySQL, Redis, and Nginx directly on the
VPS, run the three apps with **PM2** (`pm2 start dist/index.js --name jarvis-api`, etc.), and use
the same Nginx config (proxying to `127.0.0.1:3000`). Docker Compose is recommended for
reproducibility.
