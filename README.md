# Jarvis

**Jarvis manages a shared schedule for a small group** — a family, friend group, or team. People
tell Jarvis about appointments, vacations, and reminders in plain language, and Jarvis keeps one
shared calendar. It listens on three channels:

- **WhatsApp** — Jarvis *hosts* a WhatsApp group (official Cloud API Groups, ≤8 members + Jarvis);
  members join via an invite link and chat naturally.
- **Email** — each group can forward schedules (appointment confirmations, itineraries, etc.) to
  Jarvis's dedicated mailbox; the worker polls it over IMAP and extracts events.
- **Web** — a chat UI (handy for testing) plus a per-group read-only **iCal feed** you can subscribe
  to in any calendar app.

Natural-language understanding (turning messages and forwarded emails into structured events) is
powered by **Anthropic Claude** with an agentic tool-use loop. Times are stored in UTC and rendered
in each group's time zone.

> ⚠️ **WhatsApp groups are business-hosted.** The official Cloud API does not let a bot join your
> existing personal group; instead Jarvis creates/hosts the group and members join it (max 8 +
> Jarvis). The exact Groups API send/webhook payloads are marked `TODO: confirm` in
> `apps/api/src/whatsapp/` and finalized once your business number has Groups access.

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
| `apps/api` | Fastify: REST (groups/events), iCal feed, health, Socket.IO chat, WhatsApp webhook |
| `apps/web` | React + Vite single-page app (chat UI) |
| `apps/worker` | IMAP email polling + reminder cron jobs (BullMQ + node-cron) |
| `packages/agent` | Claude engine: schedule tools, event extraction, datetime/tz, agentic loop, persistence |
| `packages/db` | Prisma schema + shared `PrismaClient` (MySQL): `Group` / `Member` / `Event` |
| `packages/shared` | Shared types + the iCal builder |

## How a schedule entry flows

```
WhatsApp group msg ─┐
forwarded email ────┼─► packages/agent ─► Claude (extract / tool use) ─► Event in MySQL
web chat ───────────┘                                                         │
                                                          iCal feed  ◄─────────┤
                                                          reminders (worker) ◄─┘
```

- **WhatsApp/web:** the conversational agent (`runAgent`) calls schedule tools
  (`create_event`, `list_events`, `find_event`, `cancel_event`).
- **Email:** the worker polls IMAP, matches the sender to a group member, and `extractEvents`
  pulls structured events from the body.

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

## Channels & setup

### WhatsApp (Meta Cloud API — hosted groups)

1. Create a Meta app with the WhatsApp product; note the **App ID**, **App Secret**, **Phone
   Number ID**, **WhatsApp Business Account ID**, and a permanent **access token**. Confirm your
   number has **Groups API** access in the Meta dashboard.
2. Put them in `.env` along with a `WHATSAPP_VERIFY_TOKEN` you invent.
3. Point the webhook at `https://YOUR_DOMAIN/api/whatsapp/webhook` with that verify token, and
   subscribe to the `messages` field.
4. Create a group record (`POST /api/groups`), then provision the WhatsApp group via the Groups API
   and store its id on the group (`whatsappGroupId`) so inbound messages route correctly.

Inbound messages are verified via `X-Hub-Signature-256` (HMAC of the raw body with the app secret),
routed to the matching group, handed to the Claude agent, and the reply is sent back to the group.
The exact group send/webhook field names are marked `TODO: confirm` in `apps/api/src/whatsapp/`.

### Email (IMAP)

1. Create a dedicated mailbox, e.g. `jarvis@yourdomain` (Hostinger email provides MX + IMAP).
2. Set `IMAP_HOST` / `IMAP_USER` / `IMAP_PASSWORD` (and optionally `IMAP_PORT`/`IMAP_TLS`) in `.env`.
3. Add members with their personal email (`POST /api/groups/:id/members`). When a member forwards a
   schedule, the worker matches the sender to their group and extracts events automatically.

Email polling is disabled until `IMAP_HOST`/`IMAP_USER`/`IMAP_PASSWORD` are set. To switch to a
real-time inbound-parse webhook later, replace `apps/worker/src/email/imap.ts` with a route that
calls `ingestForwardedEmail(...)` — the rest is unchanged.

### Calendar (iCal feed)

Each group exposes a read-only feed at `/api/calendar/<icalToken>.ics` (the token is created with the
group). Subscribe to it in Apple/Google/Outlook Calendar. `POST /api/groups` returns the path.

## Deployment

See [`deploy/README.md`](deploy/README.md) for the Hostinger VPS + Docker Compose + Let's Encrypt
walkthrough.
