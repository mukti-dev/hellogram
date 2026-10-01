# Hellogram

Give out a number. Keep yours private. Chat and voice call without sharing your real mobile number.

- Product brief: [HELLOGRAM_BUILD_PROMPT.md](HELLOGRAM_BUILD_PROMPT.md)
- Architecture (decisions, schema, API, layering): [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- Operations (deploy, backups, breach / CERT-In / legal requests): [docs/RUNBOOKS.md](docs/RUNBOOKS.md)

## Stack

React + Vite PWA · Node + Fastify + Prisma · PostgreSQL 16 · Redis 7 · Socket.IO · BullMQ · WebRTC + coturn (relay-only).
Clean architecture: **Controller → Service → Repository** (architecture §3).

| App | Port | What |
|---|---|---|
| `apps/web` | 5173 | User PWA (+ public number pages `hellogram.app/A482719K`) |
| `apps/api` | 4000 | REST `/v1` + Socket.IO `/rt` |
| `apps/worker` | — | Background jobs (retention sweeps, push, billing, phone changes) |
| `apps/admin` | 5174 | Admin panel (moderation, grievances, legal requests, audit) |
| `apps/admin-api` | 4100 | Admin API (email + password + TOTP, RBAC, audit log) |

## Prerequisites

- Node.js 22.12+ (see `.nvmrc`), pnpm 9, Docker Desktop
- For calls: coturn (`docker compose --profile calls`, or `brew install coturn`)

## First-time setup

```bash
pnpm install
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/admin-api/.env.example apps/admin-api/.env
cp packages/db/.env.example packages/db/.env
pnpm db:up          # Postgres on :5433, Redis on :6379
pnpm db:migrate     # apply migrations (and generate the Prisma client)
pnpm db:seed        # optional: demo data matching the designs
```

Postgres runs on **5433** so it doesn't clash with a locally installed Postgres on 5432.

## Run

```bash
pnpm dev
```

`pnpm dev` also starts the local TURN relay that voice calls need (127.0.0.1:3478, dev secret
`dev-turn-secret-change-me`). Calls are relay-only, so **without the relay a call stays on "Connecting…"** and
gives up after 20 seconds. If coturn isn't installed, `pnpm dev` says so — install it with `brew install coturn`.

To run the relay by hand:

```bash
turnserver -c infra/coturn/turnserver.local.conf
```

(or `docker compose -f infra/docker-compose.yml --profile calls up -d coturn` — then set `TURN_URLS` in `apps/api/.env` to `localhost`).

## Testing it yourself

**Logging in.** SMS isn't connected yet: `apps/api/.env` has `OTP_BYPASS=true`, so **any 6-digit code works**.
The real codes are also printed in the API log (`DEV SMS: OTP`). The API refuses to start with the bypass in production.

**Demo data** (`pnpm db:seed`): log in with mobile **99999 00001** — numbers *Rahul Deals* (OLX), *Coffee Chats*
(Dating), *Rental Enquiries* (Tenants, paused, paid), 3 pending requests, 4 chats and a call log. The other people
(Amit, Sneha, Rohit, Priya, Vikram, Karan, Neha) are 99999 00002 … 00008 — open a second browser (or a private window)
as one of them to chat and call live.

**Firebase Phone Auth** (real SMS without DLT): set `PHONE_AUTH_PROVIDER=firebase`, `FIREBASE_PROJECT_ID` and
`SMS_PROVIDER=none` in `apps/api/.env`, and `VITE_PHONE_AUTH=firebase` + the `VITE_FIREBASE_*` web config in
`apps/web/.env` (see `apps/web/.env.example`). Firebase test numbers (set in the console) work without sending SMS.

**Payments.** Razorpay isn't connected yet: `BILLING_PROVIDER=dev` shows a **test payment** dialog for the 3rd+ number.
Settings → Plan & billing has "Simulate failed renewal" to try the grace → pause → retire flow.

**Admin panel.** Create yourself an admin, then scan the printed TOTP secret with an authenticator app:

```bash
ADMIN_PASSWORD='choose-a-long-password' pnpm --filter @hellogram/admin-api create-admin you@example.com admin
```

Open http://localhost:5174 (roles: `admin`, `moderator`, `grievance_officer`).

## Quality checks

```bash
pnpm lint                                      # ESLint, incl. clean-architecture layer boundaries
pnpm typecheck
pnpm test                                      # unit + HTTP tests (no Docker needed)
pnpm --filter @hellogram/api test:int          # integration: real Postgres + Redis + sockets
pnpm --filter @hellogram/admin-api test:int    # admin API integration
pnpm --filter @hellogram/web e2e               # Playwright (needs `pnpm dev` + TURN; uses local Chrome)
k6 run tests/load/chat.js                      # load test (staging only)
```

## Production

`pnpm build` bundles each Node service with esbuild and builds the static web/admin apps.
Docker images and a single-server Compose file are in `infra/` — see [docs/RUNBOOKS.md](docs/RUNBOOKS.md) → Deploy.

## Layout

```
apps/        api · worker · admin-api · web · admin
packages/    shared · domain · application · infrastructure · db · ui · config
infra/       docker-compose (dev), docker-compose.prod, Dockerfile, Caddyfile, coturn configs
docs/        ARCHITECTURE.md · RUNBOOKS.md
tests/load/  k6 scripts
```

## Build phases

| Phase | Scope | Status |
|---|---|---|
| 0 | Architecture | ✅ |
| 1 | Foundation: monorepo, Docker, Prisma, Fastify skeleton, UI kit, app shell, light/dark | ✅ |
| 2 | Auth: phone OTP, email login, 18+ consent, JWT + rotating refresh, devices | ✅ |
| 3 | Numbers: codes, 2 free / 5 max, share link + QR, pause/delete, avatars | ✅ |
| 4 | Contact requests + public number page + sign-up from a link | ✅ |
| 5 | Realtime chat: ticks, typing, delete, nicknames, retention, offline outbox | ✅ |
| 6 | Safety: silent account-level blocks, reports + evidence, retention sweeper | ✅ |
| 7 | PIN lock: unlock tokens, lockouts, forgot-PIN wipe | ✅ |
| 8 | Voice calls: WebRTC relay-only via coturn, call screens, call log | ✅ |
| 9 | Billing (Razorpay + dev simulator), GST invoices, Web Push | ✅ |
| 10 | Admin + compliance: admin app, grievances, legal log, export, deletion, phone change | ✅ |
| 11 | Hardening: security review fixes, a11y, PWA icons, prod builds, Docker, CI, runbooks | ✅ |
