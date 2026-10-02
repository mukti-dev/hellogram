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
| `apps/site` | 5176 | Landing page — `hellogram.in` (its **Sign in** button opens the web app) |
| `apps/web` | 5173 | User PWA — `app.hellogram.in` (+ public number pages; share links are `hellogram.in/A482719K`) |
| `apps/api` | 4000 | REST `/v1` + Socket.IO `/rt` |
| `apps/worker` | — | Background jobs (retention sweeps, push, billing, phone changes) |
| `apps/admin` | 5174 | Admin panel — `admin.hellogram.in` (moderation, grievances, legal requests, audit) |
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

**Signing up and logging in.** Sign up at `/signup` (name, mobile, date of birth, gender, password; 18+ only),
then enter the code sent to the mobile. Log in with mobile + password; a device that hasn't verified the mobile
before also asks for a code, once. "Forgot password?" resets it with a code. With `OTP_BYPASS=true` in
`apps/api/.env` **any 6-digit code works** and codes are printed in the API log (`DEV SMS: OTP`); the API refuses
to start with the bypass in production.

**Demo data** (`pnpm db:seed`): log in with mobile **99999 00001** and password **Hello@2026** — numbers *Rahul Deals* (OLX), *Coffee Chats*
(Dating), *Rental Enquiries* (Tenants, paused, paid), 3 pending requests, 4 chats and a call log. The other people
(Amit, Sneha, Rohit, Priya, Vikram, Karan, Neha) are 99999 00002 … 00008 — open a second browser (or a private window)
as one of them to chat and call live.

**2Factor** (Indian numbers; code by voice call, or SMS with an approved template): in `apps/api/.env` set
`OTP_BYPASS=false`, `PHONE_AUTH_PROVIDER=otp`, `SMS_PROVIDER=twofactor`, `TWOFACTOR_API_KEY=…` (optional
`TWOFACTOR_OTP_TEMPLATE=…`). 2Factor makes and checks the code; the app keeps its own limits and tells people
they may get a call. Problems are logged under `component: "twofactor"`.

**Browser tests refuse to run while `apps/api/.env` would send real codes** (any `SMS_PROVIDER` other than
`console`, or `OTP_BYPASS` not `true`), because they sign up made-up numbers. To test while your own setup sends
real codes, start the safe test copies from `.claude/launch.json` — `api-e2e` (port 4010, codes only printed) and
`web-e2e` (port 5180) — then run `E2E_BASE_URL=http://localhost:5180 pnpm --filter @hellogram/web e2e`.

**Message Central VerifyNow** (real SMS without DLT paperwork, Indian numbers): in `apps/api/.env` set
`OTP_BYPASS=false`, `PHONE_AUTH_PROVIDER=otp`, `SMS_PROVIDER=messagecentral`, `MESSAGECENTRAL_CUSTOMER_ID=…`,
`MESSAGECENTRAL_AUTH_TOKEN=…` (from their dashboard; or `MESSAGECENTRAL_PASSWORD=…` to let the app renew tokens itself). Message Central makes and checks the code; the app keeps its own limits
(send rate, 5 wrong tries, 5-minute expiry, single use). Problems are logged by the API under `component: "messagecentral"`.

**Fast2SMS** (real SMS, Indian numbers): in `apps/api/.env` set `OTP_BYPASS=false`, `PHONE_AUTH_PROVIDER=otp`,
`SMS_PROVIDER=fast2sms`, `FAST2SMS_API_KEY=…` (and `FAST2SMS_ROUTE=dlt` + `FAST2SMS_OTP_TEMPLATE_ID` once you have a DLT
template). Failures are logged by the API as "Fast2SMS rejected the OTP" with Fast2SMS's reason.

**Firebase Phone Auth** (real SMS without DLT): set `PHONE_AUTH_PROVIDER=firebase`, `FIREBASE_PROJECT_ID` and
`SMS_PROVIDER=none` in `apps/api/.env`, and `VITE_PHONE_AUTH=firebase` + the `VITE_FIREBASE_*` web config in
`apps/web/.env` (see `apps/web/.env.example`). Firebase test numbers (set in the console) work without sending SMS.

**Photos and files.** The paperclip in a chat sends photos, PDFs, Office files, ZIPs and text files (10 MB max).
Locally the files are stored encrypted in `.data/private` (try opening one — it's unreadable). For S3, follow
[docs/RUNBOOKS.md](docs/RUNBOOKS.md) §8 and set `ATTACHMENT_STORAGE=s3` + `S3_*` + `ATTACHMENT_ENCRYPTION_KEY`
in **both** `apps/api/.env` and `apps/worker/.env`.

**Payments.** Razorpay isn't connected yet: `BILLING_PROVIDER=dev` shows a **test payment** dialog for the 3rd+ number.
Settings → Plan & billing has "Simulate failed renewal" to try the grace → pause → retire flow.

**Admin panel.** Create yourself an admin, then scan the QR code it prints with an authenticator app
(to see the QR code again later: `pnpm --filter @hellogram/admin-api admin-qr you@example.com`):

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
Docker images and a single-server Compose file are in `infra/` — nginx serves `hellogram.in` (landing),
`app.hellogram.in` (web app + API) and `admin.hellogram.in` (admin), with Let's Encrypt certificates.
Pushes to `main` are tested, built into images and deployed to the Lightsail server by GitHub Actions
(`.github/workflows/ci.yml` → `deploy.yml`). See [docs/RUNBOOKS.md](docs/RUNBOOKS.md) → Deploy for the one-time setup.

## Layout

```
apps/        api · worker · admin-api · web · admin · site
packages/    shared · domain · application · infrastructure · db · ui · config
infra/       docker-compose (dev), docker-compose.prod, Dockerfile, nginx, coturn configs
docs/        ARCHITECTURE.md · RUNBOOKS.md
infra/nginx/ nginx.conf, site templates, init-certs.sh (first HTTPS certificate)
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
