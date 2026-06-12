# Jarvis — working guide

Jarvis is a personal/family scheduling assistant: a **Circle** (household) talks to it
via WhatsApp, a web app, email ingestion, and an Alexa skill, and it manages a shared
calendar, trips/vacations, and reminders with an LLM agent.

## Workspace (pnpm monorepo, Node ≥20, pnpm@11.5.2)

- `apps/api` — Fastify 5 REST + socket.io. Auth = Google OAuth → signed session cookie;
  OAuth2 server (`/api/oauth/*`) for Alexa account linking; voice API (`/api/voice/*`).
- `apps/web` — React + Vite PWA. **Hash routing** (`#/<view>/<id>`), no nginx SPA fallback.
- `apps/worker` — BullMQ + node-cron; Baileys WhatsApp (one session per circle), imapflow
  email poller, reminders, daily brief.
- `apps/alexa` — Alexa skill (ASK SDK Lambda + interaction model). Deployed via the Amazon
  console, **not** our docker flow. Excluded from eslint/typecheck.
- `packages/agent` — the LLM agent: providers (`llm/claude.ts`, `llm/gemini.ts`), tools,
  schedule/vacation/proposal logic, prompts. Provider is chosen at runtime (Claude default).
- `packages/db` — Prisma + MySQL. `packages/shared` — shared types/enums.

**Circle** is the top-level tenant; everything (members, groups, events, vacations,
usage) is isolated per circle. `AuthUser` = a web/login identity; `Member` = a person in a
circle. Site admin (role `admin`) sees everything; per-circle admins (`CircleAdmin`) see
only their circle(s) — reuse `adminCircleScope()` / `lib/access.ts` for scoping.

## Commands

`pnpm dev` (predev builds packages first), `pnpm typecheck`, `pnpm lint`, `pnpm build`,
`pnpm test`, `pnpm db:generate`. The `@jarvis/*` packages expose types from their built
`dist/*.d.ts`, so **build packages before typecheck** in a clean checkout (this is also why
CI order is install → generate → build → typecheck → lint → test).

## Conventions

- TypeScript throughout; reuse existing helpers before adding new ones (grep first).
- Comments explain **why**, not what; match the surrounding density — terse, not chatty.
- Commit messages: a clear subject + a short body explaining the why; end with
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Work on `main`.
- **UI: no helper text.** Pages are titles + controls + errors only — omit explanatory or
  instructional microcopy. Keep pages visually consistent (page-title pattern, capitalized
  labels everywhere, e.g. `Member`/`Admin`, `Active`/`Muted`).

## Production deploy

Hostinger VPS `root@93.127.215.225`, served at `https://jarvis.passanha.com` via nginx +
docker compose. Deploy = `git push` → `rsync` (excludes `.git node_modules .env dist *.sql
data wa-auth deploy/nginx/default.conf`) → `docker compose build <svc>` → `up -d <svc>` →
`restart nginx`, then **verify** (curl health/endpoints, check logs). Web is nginx serving
`apps/web/dist` (so `apps/web/public/*` is served at site root).

**Migrations are manual** (no Prisma CLI in prod): scp the `migration.sql`, pipe it into the
mysql container, then insert a `_prisma_migrations` row with `sha256sum` of the file. Inline
ssh→mysql quoting mangles queries — always scp a `.sql` file and pipe it in.

## How I like you to work

- **Be direct and verify.** I give terse instructions ("deploy changes", "commit all
  changes"); do the work, then confirm it with evidence (curl results, logs, test output) —
  don't declare success on assumption.
- **Deploy only when I say so.** Build/verify locally first; push to prod when I ask.
- **Plan big features first.** For multi-file features, plan and get sign-off before coding;
  small fixes, just do them.
- **Tell me the hard truth.** If something isn't viable (e.g. custom Google Assistant skills
  are dead) or contradicts how it was described, say so plainly instead of building the wrong
  thing — surface the constraint and the real options.
- **Keep it clean and consistent.** I notice clutter, missing titles, and inconsistent
  capitalization; match existing patterns.
- I change direction and discard work without ceremony — when I do, revert cleanly and
  confirm prod matches.
