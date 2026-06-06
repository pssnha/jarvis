# Jarvis

A Node.js + TypeScript monorepo for a service with **two co-primary interfaces** — a web app and a
**WhatsApp conversational bot** — backed by a background worker. Natural-language understanding is
powered by **Anthropic Claude**. Real-time updates reach the browser over Socket.IO.

> The domain logic is intentionally generic scaffolding. Module, job, and tool names use
> placeholders that are easy to rename once the product scope is defined.

## Architecture

```
            ┌──────────── apps/web (React + Vite SPA) ───────────┐
 browser ───┤  Socket.IO chat  ·  REST                            │
            └───────────────────────┬─────────────────────────────┘
                                     │
 WhatsApp ──► Meta Cloud API ──► apps/api (Fastify)
                                     │  • REST + health
                                     │  • Socket.IO gateway (realtime)
                                     │  • /api/whatsapp/webhook (verify + receive)
                                     │  • BullMQ producer (enqueue jobs)
                                     ▼
                       packages/agent  ── Claude agentic loop (tool use)
                                     │
        ┌──────────── packages/db (Prisma) ── MySQL ───────────┐
        │            Redis  ── BullMQ queue + Socket.IO adapter │
        └───────────────────────┬──────────────────────────────┘
                                 ▼
                  apps/worker (BullMQ consumers + node-cron schedules)
```

## Workspace layout

| Path | What it is |
|---|---|
| `apps/api` | Fastify server: REST, health, Socket.IO, WhatsApp webhook, job producer |
| `apps/web` | React + Vite single-page app (includes a minimal chat UI) |
| `apps/worker` | BullMQ queue consumers + node-cron scheduled jobs |
| `packages/agent` | Claude NL engine (client, system prompt, tools, agentic loop, conversation persistence) |
| `packages/db` | Prisma schema + shared `PrismaClient` (MySQL) |
| `packages/shared` | Shared TypeScript types and constants |

## Prerequisites

- Node.js ≥ 20 (tested on 22/26)
- pnpm (`npm install -g pnpm`)
- Docker (for local MySQL + Redis, and for production)

## Local development

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env        # then fill in ANTHROPIC_API_KEY etc.

# 3. Start MySQL + Redis
docker compose -f docker-compose.dev.yml up -d

# 4. Generate the Prisma client and run the first migration
pnpm --filter @jarvis/db generate
pnpm --filter @jarvis/db migrate     # creates tables (prisma migrate dev)

# 5. Run everything (api + web + worker)
pnpm dev
```

- Web app: <http://localhost:5173>
- API health: <http://localhost:3000/api/healthz>

> `pnpm dev` builds the workspace packages first (`predev`), then runs the apps in parallel. After
> editing a `packages/*` file, rebuild it (`pnpm --filter @jarvis/<pkg> build`) for the change to be
> picked up by the running apps.

## Quality gates

```bash
pnpm -r typecheck
pnpm lint
pnpm -r build
pnpm -r test
```

## WhatsApp setup (Meta Cloud API)

1. Create a Meta app with the WhatsApp product; note the **App ID**, **App Secret**, **Phone
   Number ID**, **WhatsApp Business Account ID**, and a permanent **access token**.
2. Put them in `.env` along with a `WHATSAPP_VERIFY_TOKEN` you invent.
3. Point the webhook at `https://YOUR_DOMAIN/api/whatsapp/webhook`, using the same verify token, and
   subscribe to the `messages` field.

Inbound messages are verified via `X-Hub-Signature-256` (HMAC of the raw body with the app secret),
handed to the Claude agent, and the reply is sent back through the Cloud API.

## Deployment

See [`deploy/README.md`](deploy/README.md) for the Hostinger VPS + Docker Compose + Let's Encrypt
walkthrough.
