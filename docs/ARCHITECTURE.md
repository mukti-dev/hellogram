# Hellogram — Architecture (Phase 0)

> Status: **Draft for approval.** No feature code is written until this is approved.
> Source of truth: `HELLOGRAM_BUILD_PROMPT.md` + the decisions in §1. Where they differ, §1 wins.

---

## Contents

1. [Decisions that override the build prompt](#1-decisions-that-override-the-build-prompt)
2. [System overview](#2-system-overview)
3. [Code architecture](#3-code-architecture)
4. [Identifiers and number codes](#4-identifiers-and-number-codes)
5. [Data model (Prisma schema)](#5-data-model-prisma-schema)
6. [Policy rules (who can reach whom)](#6-policy-rules-who-can-reach-whom)
7. [REST API contract](#7-rest-api-contract)
8. [Socket.IO contract](#8-socketio-contract)
9. [Voice calls](#9-voice-calls)
10. [Background jobs](#10-background-jobs)
11. [Security and rate limits](#11-security-and-rate-limits)
12. [Third-party providers](#12-third-party-providers)
13. [Configuration](#13-configuration)
14. [Design tokens](#14-design-tokens)
15. [Deployment (MVP)](#15-deployment-mvp)
16. [Open items](#16-open-items)

---

## 1. Decisions that override the build prompt

| Topic | Decision |
|---|---|
| Stack & style | React + Vite (web) · Node + Fastify + Prisma (backend). Clean architecture: Controller → Service → Repository (§3). |
| Budget | ₹3,000–4,000 / month. Free / open-source code tools only; paid services are usage-based only. |
| Voice | **WebRTC + Socket.IO signalling + coturn, relay-only.** No LiveKit, no STUN peer-to-peer (peers never see each other's IP). |
| Admin | Separate `admin-api` process on a private domain. |
| Error tracking | Sentry SDK → Sentry free plan, strict scrubbing. |
| Number code | No prefix. `L DDDDDD L` → e.g. `A482719K`. Uppercase, letters exclude `I` and `O`. No checksum. Displayed exactly as stored, in monospace. Expandable to 7 digits later. |
| Ticks | 🕐 sending (client) → ✓ stored on server → ✓✓ delivered to a recipient device → read (only if reader has `readReceipts`). |
| Blocking | Account-level and silent. Blocked side sees **"Unknown"** only in the conversation where Block was pressed; every other path between the two accounts is silently suppressed (one tick forever / ring-out / pending forever). See §6. |
| Email | Sign-up always needs phone OTP. A verified email can then be used to **log in** and to **recover** the account. |
| Phone change | Via email login → OTP to new phone → 24 h cooling-off, notice to old phone. |
| Contacts screen | **Removed from v1.** |
| Chat nickname | A user can rename a chat. Private to that user (stored on their conversation-member row). |
| Billing | **One Razorpay subscription per account**, `quantity` = number of paid numbers (single UPI mandate). |
| PIN lock | In MVP. **4-digit** PIN. |
| Intro message | Optional (per design). Empty → default text "Hi, I'd like to connect." *(assumed — see §16)* |
| Media | Not in v1. Hidden behind `FEATURE_MEDIA`. |

---

## 2. System overview

Modular monolith: one codebase, three backend processes, shared domain code.

```
                          Cloudflare (DNS, TLS, WAF, Turnstile)
                                        │
     ┌──────────── Web PWA / Admin (static, Cloudflare Pages or S3+CloudFront)
     │
     │ HTTPS REST + WSS                                  WebRTC audio (TURN/UDP 3478, TLS 443)
     ▼                                                              │
┌──────────────────────────────── Server (Docker Compose) ─────────┼───────┐
│  Caddy (reverse proxy, TLS)                                      ▼       │
│   ├── api        Fastify REST /v1 + Socket.IO /rt          coturn        │
│   ├── admin-api  Fastify, private domain, own auth                        │
│   └── worker     BullMQ processors + schedulers                           │
│  Postgres 16   ·   Redis 7 (adapter, rate limits, queues, locks)          │
└───────────────────────────────────────────────────────────────────────────┘
     │ backups / avatars / exports                  │ SMS / email / payments / push
     ▼                                              ▼
    S3                                  MSG91 · SES · Razorpay · Web Push
```

**Principles**

- **Golden rule:** clients only ever see persona IDs and number codes. `accountId`, phone and email never leave the server except the caller's own on `/me`.
- **One policy module** (`packages/domain/policy`) answers every "can X reach Y and what does each side see?" question. All modules call it.
- **Stateless API.** Socket.IO uses the Redis adapter; any instance can serve any user.
- **Business logic lives in `packages/domain`,** not in Fastify handlers or React components, so the React Native app can reuse it later.

---

## 3. Code architecture

**Stack:** Frontend — React + Vite (TypeScript). Backend — Node.js + Fastify + Prisma (TypeScript).
**Style:** Clean architecture. Every request flows **Controller → Service → Repository**, dependencies point inward only, and business rules never depend on Fastify, Prisma, Socket.IO or React.

### 3.1 Monorepo structure

```
hellogram/
├── apps/
│   ├── api/                    Fastify REST + Socket.IO (see 3.2)
│   ├── worker/                 BullMQ job handlers → call the same services as api
│   ├── admin-api/              Same layering as api, admin auth (password + TOTP), RBAC, audit
│   ├── web/                    React + Vite PWA (see 3.4)
│   └── admin/                  React + Vite admin panel (same structure as web)
├── packages/
│   ├── shared/                 Zod schemas, DTO types, error codes, constants, code-format utils (client + server)
│   ├── domain/                 Pure business layer: entities, policy, rules, domain errors, ports (interfaces)
│   ├── application/            Services (use cases) — shared by api, worker, admin-api
│   ├── infrastructure/         Prisma repositories, Redis, providers (MSG91, SES, Razorpay, Web Push, coturn), event bus
│   ├── db/                     Prisma schema, migrations, seed, Prisma client factory
│   ├── ui/                     Design tokens + shared React components
│   └── config/                 tsconfig, eslint (incl. layer-boundary rules), tailwind preset, env validation
├── infra/
│   ├── docker-compose.yml      postgres, redis, coturn (dev)
│   ├── docker-compose.prod.yml + caddy/, coturn/
│   └── scripts/                backup, restore
├── docs/                       ARCHITECTURE.md, RUNBOOKS.md (breach, CERT-In incident, legal request)
├── .github/workflows/          lint, typecheck, test, e2e, build
└── turbo.json  pnpm-workspace.yaml  package.json
```

### 3.2 Backend layers

```
          ┌──────────────────────────────────────────────────────────────┐
 HTTP ───▶│ Route + Controller     (apps/api/src/modules/*)             │  Fastify only here
 Socket ─▶│ Socket handler         (apps/api/src/realtime/*)            │
 Job ────▶│ Job handler            (apps/worker/src/jobs/*)             │
          └──────────────┬───────────────────────────────────────────────┘
                         ▼  calls with plain input DTOs
          ┌──────────────────────────────────────────────────────────────┐
          │ Service (use case)     (packages/application)               │  orchestration, transactions
          └───────┬───────────────────────────┬──────────────────────────┘
                  ▼ uses                      ▼ depends on interfaces (ports)
          ┌────────────────────┐   ┌──────────────────────────────────────┐
          │ Domain             │   │ Repository / Provider interfaces     │
          │ (packages/domain)  │   │ (packages/domain/ports)              │
          │ entities, policy,  │   └──────────────────┬───────────────────┘
          │ rules, errors      │                      ▲ implemented by
          └────────────────────┘   ┌──────────────────┴───────────────────┐
                                   │ Infrastructure (packages/infra…)     │  Prisma, Redis, MSG91,
                                   │ PrismaPersonaRepository, …           │  Razorpay, Socket.IO emitter
                                   └──────────────────────────────────────┘
```

| Layer | Responsibility | May import | Must NOT |
|---|---|---|---|
| **Route** | Register path, attach Zod schemas, auth / rate-limit / unlock hooks | controller, `shared` | contain logic |
| **Controller** | Read validated request + auth context → call one service method → map result to response DTO via mapper | application, `shared` | touch Prisma, Redis, or business rules |
| **Service** (use case) | Orchestrate a use case: load via repositories, apply domain rules/policy, open transaction, save, publish domain events | domain, ports | import Fastify, Prisma, Socket.IO, provider SDKs |
| **Domain** | Entities, value objects (`NumberCode`, `Pin`, `Retention`), `policy`, pure rule functions, domain errors | nothing (pure TS) | do I/O |
| **Repository** (interface in domain, impl in infrastructure) | Persistence only: queries, mapping Prisma rows ↔ domain entities | db (Prisma) | contain business rules |
| **Provider** (interface in domain, impl in infrastructure) | External services: SMS, email, billing, push, TURN creds, event publishing | SDKs | contain business rules |
| **Mapper / Serializer** | Domain entity → response DTO; enforces the golden rule (no accountId / phone / email / others' nickname) | domain, `shared` | — |

**Supporting pieces**

- **Dependency injection:** one composition root per app (`apps/api/src/container.ts`) builds repositories → providers → services with constructor injection and registers them on Fastify. Tests swap in fakes. (Plain factories, or `awilix` if it grows.)
- **Transactions:** a `UnitOfWork` port. `uow.run(async (tx) => …)` gives repositories bound to one Prisma transaction, so services control transaction boundaries without importing Prisma.
- **Domain events → realtime:** services publish events (`MessageSent`, `RequestReceived`, `CallStarted`…) through an `EventPublisher` port. An infrastructure adapter turns them into Socket.IO emits + push jobs, applying locked-persona redaction. Services never know about sockets.
- **Errors:** services/domain throw typed `DomainError(code)`; one Fastify error handler maps codes to HTTP status + `{ error: { code, message } }`. Controllers have no try/catch.
- **Auth context:** the auth plugin puts `{ accountId, sessionId, unlockedPersonaIds }` on the request; controllers pass it to services as an explicit `Actor` argument.
- **Validation:** Zod schemas from `packages/shared` at the route (shape) — business validation in domain/services.
- **Boundaries enforced by lint:** `eslint-plugin-boundaries` fails CI if a layer imports something it must not.

### 3.3 Backend module layout (example: personas)

```
apps/api/src/
├── server.ts                 Fastify bootstrap
├── container.ts              composition root (DI)
├── plugins/                  auth, unlock-token, rate-limit, error-handler, csrf, request-context
├── realtime/                 socket gateway, handlers (thin, call services), room management
└── modules/
    └── personas/
        ├── persona.routes.ts        paths + schemas + hooks
        ├── persona.controller.ts    request → service → mapper → reply
        └── persona.mapper.ts        entity → PersonaDto / OwnPersonaDto

packages/application/src/personas/
├── create-persona.service.ts        one file per use case (or PersonaService with methods)
├── retire-persona.service.ts
├── update-persona.service.ts
└── __tests__/                       unit tests with fake repositories

packages/domain/src/personas/
├── persona.entity.ts
├── number-code.ts                   generation + validation rules (§4.2)
├── persona.rules.ts                 slot limits, churn limit, pause/retire rules
└── ports/persona.repository.ts      interface PersonaRepository

packages/infrastructure/src/persistence/
└── prisma-persona.repository.ts     implements PersonaRepository
```

**Example flow — `POST /v1/personas`**

1. **Route** validates body with `createPersonaSchema`, runs auth hook.
2. **Controller** calls `createPersonaService.execute(actor, input)`.
3. **Service** loads active persona count + recent creations (repository), asks domain `canCreatePersona()` (2 free / 5 max / 3 per 7 days). Free slot → generates code via `NumberCode.generate()`, retries on collision, saves in a transaction. Paid slot → saves `PersonaDraft`, calls `BillingProvider.createCheckout()`, returns `PaymentRequired`.
4. **Repository** writes via Prisma.
5. **Service** publishes `PersonaCreated` → own devices get `persona:updated`.
6. **Controller** maps entity → `OwnPersonaDto` and replies `201`, or `402 { checkout }`.

### 3.4 Frontend architecture (React + Vite)

Feature-based, with the same "UI → logic → data" separation:

```
apps/web/src/
├── app/                      bootstrap, router, providers (QueryClient, theme, i18n), layouts (mobile tabs / desktop sidebar)
├── features/
│   └── numbers/
│       ├── pages/            route-level screens (MyNumbersPage, NumberDetailPage)
│       ├── components/       presentational components (NumberCard, ShareCard)
│       ├── hooks/            useNumbers, useCreateNumber — TanStack Query / Zustand (the "controller" of the UI)
│       ├── api/              numbers.api.ts — typed calls to /v1 (the frontend "repository")
│       └── model/            view models, selectors, feature-local state
│   ├── auth/  inbox/  chat/  requests/  calls/  settings/  public-entry/  billing/
├── core/
│   ├── http/                 fetch client: auth header, refresh-on-401, unlock-token header, error mapping
│   ├── realtime/             socket client, event → query-cache updates
│   ├── webrtc/               call engine (RTCPeerConnection, relay-only)
│   ├── offline/              outgoing message queue (IndexedDB) + retry
│   └── push/                 service-worker registration, push subscribe
├── shared/                   generic hooks, utils, formatters
└── i18n/                     locale files
```

| Layer | Responsibility | Rule |
|---|---|---|
| **Page / Component** | Render and handle user input | No `fetch`, no business rules; uses hooks only |
| **Hook** | Data fetching, mutations, cache updates, local UI state | Calls the feature `api/` and `core/` services |
| **API (client repository)** | Typed HTTP calls using `shared` Zod schemas | No React imports |
| **Core services** | HTTP, socket, WebRTC, offline queue, push | Framework-free where possible, so React Native can reuse them |

Business rules the client also needs (code format, PIN rules, message length, retention labels) come from `packages/shared` / `packages/domain` — never re-implemented in components.

### 3.5 Testing per layer

| Layer | Test type |
|---|---|
| Domain (policy, rules, number code) | Pure unit tests — fast, exhaustive (every §6 rule) |
| Services | Unit tests with in-memory fake repositories/providers |
| Repositories | Integration tests against real Postgres (Testcontainers) |
| Routes / controllers | HTTP integration tests via `fastify.inject()` + serializer leak test |
| Frontend | Vitest + Testing Library for hooks/components; Playwright E2E for critical flows |

---

## 4. Identifiers and number codes

### 4.1 Internal IDs

| Entity | ID type | Why |
|---|---|---|
| Account, Session, admin tables | UUIDv4 | Never exposed. |
| Persona, Conversation, Request, Call, Report | UUIDv4 | Exposed; random so creation order/time can't be inferred. |
| Message | UUIDv7 | Time-ordered for cursors; its timestamp is already visible as `createdAt`. |

Persona `createdAt` is **never** exposed to other users (two numbers created seconds apart would correlate).

### 4.2 Number code

| Property | Rule |
|---|---|
| Format | `^[A-HJ-NP-Z][0-9]{6,7}[A-HJ-NP-Z]$` — letter, 6 digits (7 later), letter |
| Alphabet | 24 uppercase letters (no `I`, `O`) |
| Space | 24 × 10⁶ × 24 ≈ **576 M** (6 digits); ≈ 5.76 B with 7 digits |
| Randomness | `crypto.randomInt` for every character |
| Rejected digit blocks | all same (`000000`), ascending / descending runs (`123456`, `987654`), repeated pairs/triples (`121212`, `123123`), and a small denylist |
| Uniqueness | Must not exist in `Persona.code` **or** `RetiredCode.code`. Insert retries up to 5× on collision. |
| Never reused | On retire, the code is written to `RetiredCode` in the same transaction. |
| Storage | Uppercase, `varchar(9)` |
| Display | Exactly as stored (`A482719K`), monospace font |
| URL | `https://hellogram.app/A482719K`. Lower-case input is accepted and 301-redirected to upper-case. Route pattern never collides with app routes. |
| 7-digit switch | Config flag `CODE_DIGITS=7`. Switch when ~60 % of the 6-digit space is used. Validation already accepts both. |

---

## 5. Data model (Prisma schema)

> Conventions: `snake_case` table names via `@@map`, camelCase column names, all timestamps `timestamptz`, email stored lower-cased, phone in E.164.
> Refresh tokens and OTP codes are stored as keyed HMAC-SHA256 hashes (high-entropy tokens need an indexed lookup; argon2id is used for PINs).

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ───────────────────────────── Enums ─────────────────────────────

enum AccountStatus   { active suspended banned deleted }
enum OtpChannel      { sms email }
enum OtpPurpose      { login email_login email_verify pin_reset phone_change account_delete }
enum PersonaStatus   { active paused retired }
enum PauseReason     { user billing admin }
enum LabelKind       { olx dating tenants other }
enum Retention       { forever d90 d30 d7 h24 }
enum RequestStatus   { pending accepted declined blocked expired }
enum MessageType     { text system }
enum CallStatus      { ringing answered missed declined ended failed }
enum CallEndReason   { completed no_answer busy declined cancelled network_error suppressed }
enum ReportReason    { harassment spam scam sexual_content threat other }
enum ReportStatus    { open reviewing actioned dismissed }
enum SubStatus       { created authenticated active past_due grace cancelled completed }
enum AdminRole       { moderator admin grievance_officer }
enum ActorType       { system admin account }
enum AccountAction   { warn suspend unsuspend ban unban }
enum GrievanceStatus { open acknowledged resolved closed }
enum ExportStatus    { pending ready expired failed }

// ──────────────────────────── Accounts ───────────────────────────

model Account {
  id              String        @id @default(uuid()) @db.Uuid
  phone           String        @unique                 // E.164
  email           String?       @unique                 // lower-cased
  emailVerifiedAt DateTime?
  ageConfirmedAt  DateTime
  status          AccountStatus @default(active)
  suspendedUntil  DateTime?
  createdAt       DateTime      @default(now())
  updatedAt       DateTime      @updatedAt
  deletedAt       DateTime?

  sessions        Session[]
  consents        ConsentRecord[]
  phoneChanges    PhoneChange[]
  personas        Persona[]
  blocksMade      Block[]         @relation("BlocksMade")
  blocksReceived  Block[]         @relation("BlocksReceived")
  subscriptions   Subscription[]
  pushSubs        PushSubscription[]
  actions         AccountActionLog[]
  exports         DataExport[]
  personaDrafts   PersonaDraft[]

  @@map("accounts")
}

model ConsentRecord {
  id         String   @id @default(uuid()) @db.Uuid
  accountId  String   @db.Uuid
  version    String                          // e.g. "2026-09-v1"
  acceptedAt DateTime @default(now())
  ipHash     String?
  account    Account  @relation(fields: [accountId], references: [id])

  @@index([accountId])
  @@map("consent_records")
}

model PhoneChange {
  id          String    @id @default(uuid()) @db.Uuid
  accountId   String    @db.Uuid
  newPhone    String
  verifiedAt  DateTime                       // OTP to new phone passed
  effectiveAt DateTime                       // verifiedAt + 24h
  completedAt DateTime?
  cancelledAt DateTime?
  account     Account   @relation(fields: [accountId], references: [id])

  @@index([accountId])
  @@map("phone_changes")
}

model Session {
  id          String         @id @default(uuid()) @db.Uuid
  accountId   String         @db.Uuid
  deviceName  String?
  userAgent   String?
  ipHash      String?
  createdAt   DateTime       @default(now())
  lastSeenAt  DateTime       @default(now())
  expiresAt   DateTime                       // absolute max (e.g. 90 days)
  revokedAt   DateTime?
  revokeReason String?                       // logout | remote_logout | reuse_detected | account_action
  account     Account        @relation(fields: [accountId], references: [id])
  tokens      RefreshToken[]

  @@index([accountId])
  @@map("sessions")
}

model RefreshToken {
  id        String    @id @default(uuid()) @db.Uuid
  sessionId String    @db.Uuid
  tokenHash String    @unique                // argon2id / HMAC of token
  createdAt DateTime  @default(now())
  usedAt    DateTime?                        // rotated; reuse of a used token revokes the session
  session   Session   @relation(fields: [sessionId], references: [id], onDelete: Cascade)

  @@index([sessionId])
  @@map("refresh_tokens")
}

model OtpChallenge {
  id         String     @id @default(uuid()) @db.Uuid
  channel    OtpChannel
  targetHash String                          // HMAC(phone|email) — lookup without storing plaintext
  purpose    OtpPurpose
  codeHash   String
  attempts   Int        @default(0)
  expiresAt  DateTime                        // now + 5 min
  consumedAt DateTime?
  ipHash     String?
  createdAt  DateTime   @default(now())

  @@index([targetHash, purpose, createdAt])
  @@map("otp_challenges")
}

// ──────────────────────────── Personas ───────────────────────────

model Persona {
  id               String        @id @default(uuid()) @db.Uuid
  accountId        String        @db.Uuid
  code             String        @unique @db.VarChar(9)
  displayName      String        @db.VarChar(40)
  avatarKey        String?                   // random S3 key, no account path
  labelKind        LabelKind     @default(other)
  labelText        String?       @db.VarChar(16)   // only for labelKind = other
  status           PersonaStatus @default(active)
  pauseReason      PauseReason?
  isPaid           Boolean       @default(false)
  acceptRequests   Boolean       @default(true)
  allowCalls       Boolean       @default(true)
  readReceipts     Boolean       @default(true)
  dndUntil         DateTime?
  defaultRetention Retention     @default(d30)
  pinHash          String?                   // argon2id, 4-digit PIN
  pinFailedCount   Int           @default(0)
  pinLockLevel     Int           @default(0) // 0 → 15m, 1 → 30m, … capped at 24h
  pinLockedUntil   DateTime?
  createdAt        DateTime      @default(now())
  updatedAt        DateTime      @updatedAt
  retiredAt        DateTime?

  account          Account       @relation(fields: [accountId], references: [id])
  requestsSent     ContactRequest[]     @relation("RequestFrom")
  requestsReceived ContactRequest[]     @relation("RequestTo")
  convsAsA         Conversation[]       @relation("ConvA")
  convsAsB         Conversation[]       @relation("ConvB")
  memberships      ConversationMember[]
  messagesSent     Message[]
  callsMade        Call[]               @relation("CallFrom")
  callsReceived    Call[]               @relation("CallTo")
  blocksFrom       Block[]              @relation("BlockFromPersona")
  blocksOf         Block[]              @relation("BlockOfPersona")
  reportsMade      Report[]             @relation("ReportBy")
  reportsAgainst   Report[]             @relation("ReportAgainst")

  @@index([accountId, status])
  @@map("personas")
}

model RetiredCode {
  code      String   @id @db.VarChar(9)
  retiredAt DateTime @default(now())

  @@map("retired_codes")
}

// Holds a paid-slot number until Razorpay confirms the subscription change.
model PersonaDraft {
  id          String    @id @default(uuid()) @db.Uuid
  accountId   String    @db.Uuid
  displayName String    @db.VarChar(40)
  labelKind   LabelKind
  labelText   String?   @db.VarChar(16)
  allowCalls  Boolean   @default(true)
  providerRef String?                        // Razorpay subscription / update id
  expiresAt   DateTime
  consumedAt  DateTime?
  account     Account   @relation(fields: [accountId], references: [id])

  @@index([accountId])
  @@map("persona_drafts")
}

// ──────────────────────── Requests & chats ───────────────────────

model ContactRequest {
  id            String        @id @default(uuid()) @db.Uuid
  fromPersonaId String        @db.Uuid
  toPersonaId   String        @db.Uuid
  introMessage  String        @db.VarChar(300)
  status        RequestStatus @default(pending)
  suppressed    Boolean       @default(false)   // blocked sender: never shown to recipient
  createdAt     DateTime      @default(now())
  respondedAt   DateTime?
  expiresAt     DateTime                        // see §16
  from          Persona       @relation("RequestFrom", fields: [fromPersonaId], references: [id])
  to            Persona       @relation("RequestTo",   fields: [toPersonaId],   references: [id])

  @@index([toPersonaId, status, createdAt])
  @@index([fromPersonaId, toPersonaId, createdAt])
  @@map("contact_requests")
}

model Conversation {
  id                    String     @id @default(uuid()) @db.Uuid
  personaAId            String     @db.Uuid     // personaAId < personaBId
  personaBId            String     @db.Uuid
  retention             Retention
  retentionChangedById  String?    @db.Uuid     // persona id
  retentionChangedAt    DateTime?
  lastMessageAt         DateTime?
  createdAt             DateTime   @default(now())
  closedAt              DateTime?                // a side retired / account deleted / banned
  personaA              Persona    @relation("ConvA", fields: [personaAId], references: [id])
  personaB              Persona    @relation("ConvB", fields: [personaBId], references: [id])
  members               ConversationMember[]
  messages              Message[]
  calls                 Call[]

  @@unique([personaAId, personaBId])
  @@map("conversations")
}

model ConversationMember {
  conversationId          String       @db.Uuid
  personaId               String       @db.Uuid
  nickname                String?      @db.VarChar(40)  // private to this member
  clearedBefore           DateTime?                     // clear chat / forgot-PIN wipe
  mutedUntil              DateTime?
  lastReadMessageId       String?      @db.Uuid
  lastDeliveredMessageId  String?      @db.Uuid
  hiddenAt                DateTime?                     // blocker closed this chat on their side
  counterpartMasked       Boolean      @default(false)  // blocked side sees "Unknown"
  conversation            Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  persona                 Persona      @relation(fields: [personaId], references: [id])

  @@id([conversationId, personaId])
  @@index([personaId])
  @@map("conversation_members")
}

model Message {
  id                   String      @id @default(uuid(7)) @db.Uuid
  conversationId       String      @db.Uuid
  senderPersonaId      String      @db.Uuid
  clientMessageId      String      @db.VarChar(64)    // idempotent retries
  type                 MessageType @default(text)
  body                 String?     @db.VarChar(4000)  // NULL after purge / delete-for-everyone
  systemPayload        Json?                          // e.g. { kind: "retention_changed", by, value }
  suppressed           Boolean     @default(false)    // silent block: never delivered
  createdAt            DateTime    @default(now())
  deliveredAt          DateTime?
  readAt               DateTime?
  deletedForEveryoneAt DateTime?
  contentPurgedAt      DateTime?
  conversation         Conversation @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  sender               Persona      @relation(fields: [senderPersonaId], references: [id])
  hiddenFor            MessageHide[]

  @@unique([senderPersonaId, clientMessageId])
  @@index([conversationId, createdAt])
  @@index([createdAt])                              // purge sweeps
  @@map("messages")
}

model MessageHide {                                   // "delete for me"
  messageId String   @db.Uuid
  personaId String   @db.Uuid
  hiddenAt  DateTime @default(now())
  message   Message  @relation(fields: [messageId], references: [id], onDelete: Cascade)

  @@id([messageId, personaId])
  @@map("message_hides")
}

// ─────────────────────────────── Calls ───────────────────────────

model Call {
  id              String         @id @default(uuid()) @db.Uuid
  conversationId  String         @db.Uuid
  callerPersonaId String         @db.Uuid
  calleePersonaId String         @db.Uuid
  status          CallStatus     @default(ringing)
  endReason       CallEndReason?                   // internal; "busy" & "suppressed" shown as no_answer
  suppressed      Boolean        @default(false)   // never shown to callee
  createdAt       DateTime       @default(now())
  answeredAt      DateTime?
  endedAt         DateTime?
  conversation    Conversation   @relation(fields: [conversationId], references: [id], onDelete: Cascade)
  caller          Persona        @relation("CallFrom", fields: [callerPersonaId], references: [id])
  callee          Persona        @relation("CallTo",   fields: [calleePersonaId], references: [id])

  @@index([callerPersonaId, createdAt])
  @@index([calleePersonaId, createdAt])
  @@index([createdAt])
  @@map("calls")
}

// ───────────────────────────── Safety ────────────────────────────

model Block {
  id               String   @id @default(uuid()) @db.Uuid
  blockerAccountId String   @db.Uuid
  blockedAccountId String   @db.Uuid
  blockerPersonaId String   @db.Uuid   // "blocked from" (shown in Settings → Blocked)
  blockedPersonaId String   @db.Uuid   // the code the user actually blocked
  conversationId   String?  @db.Uuid   // where Block was pressed (masking applies here only)
  requestId        String?  @db.Uuid
  createdAt        DateTime @default(now())
  blockerAccount   Account  @relation("BlocksMade",     fields: [blockerAccountId], references: [id])
  blockedAccount   Account  @relation("BlocksReceived", fields: [blockedAccountId], references: [id])
  blockerPersona   Persona  @relation("BlockFromPersona", fields: [blockerPersonaId], references: [id])
  blockedPersona   Persona  @relation("BlockOfPersona",   fields: [blockedPersonaId], references: [id])

  @@unique([blockerPersonaId, blockedPersonaId])
  @@index([blockerAccountId, blockedAccountId])
  @@index([blockedAccountId, blockerAccountId])
  @@map("blocks")
}

model Report {
  id                String         @id @default(uuid()) @db.Uuid
  reporterPersonaId String         @db.Uuid
  reportedPersonaId String         @db.Uuid
  conversationId    String?        @db.Uuid
  requestId         String?        @db.Uuid
  reason            ReportReason
  note              String?        @db.VarChar(1000)
  alsoBlocked       Boolean        @default(true)
  status            ReportStatus   @default(open)
  handledByAdminId  String?        @db.Uuid
  createdAt         DateTime       @default(now())
  closedAt          DateTime?
  reporter          Persona        @relation("ReportBy",      fields: [reporterPersonaId], references: [id])
  reported          Persona        @relation("ReportAgainst", fields: [reportedPersonaId], references: [id])
  evidence          ReportEvidence?

  @@index([status, createdAt])
  @@map("reports")
}

model ReportEvidence {
  id        String   @id @default(uuid()) @db.Uuid
  reportId  String   @unique @db.Uuid
  snapshot  Json     // last 50 messages: { at, senderCode, senderDisplayName, body, type } — no nicknames
  createdAt DateTime @default(now())
  report    Report   @relation(fields: [reportId], references: [id], onDelete: Cascade)

  @@map("report_evidence")
}

// ───────────────────────────── Billing ───────────────────────────

model Subscription {
  id               String    @id @default(uuid()) @db.Uuid
  accountId        String    @db.Uuid
  provider         String    @default("razorpay")
  providerSubId    String    @unique
  quantity         Int                         // number of paid numbers
  status           SubStatus
  currentPeriodEnd DateTime?
  graceUntil       DateTime?
  createdAt        DateTime  @default(now())
  updatedAt        DateTime  @updatedAt
  account          Account   @relation(fields: [accountId], references: [id])
  payments         Payment[]

  @@index([accountId, status])
  @@map("subscriptions")
}

model Payment {
  id                String       @id @default(uuid()) @db.Uuid
  subscriptionId    String       @db.Uuid
  amountPaise       Int                        // total incl. GST
  gstPaise          Int
  invoiceNo         String       @unique
  providerPaymentId String       @unique
  paidAt            DateTime
  subscription      Subscription @relation(fields: [subscriptionId], references: [id])

  @@map("payments")                            // retained 8 years (tax), account anonymised on deletion
}

model WebhookEvent {                            // idempotency for Razorpay webhooks
  id          String    @id                     // provider event id
  provider    String
  type        String
  payload     Json
  receivedAt  DateTime  @default(now())
  processedAt DateTime?

  @@map("webhook_events")
}

// ────────────────────────── Notifications ────────────────────────

model PushSubscription {
  id        String   @id @default(uuid()) @db.Uuid
  accountId String   @db.Uuid
  sessionId String?  @db.Uuid
  endpoint  String   @unique
  p256dh    String
  auth      String
  createdAt DateTime @default(now())
  account   Account  @relation(fields: [accountId], references: [id], onDelete: Cascade)

  @@index([accountId])
  @@map("push_subscriptions")
}

// ────────────────────────── Compliance / admin ───────────────────

model DataExport {
  id        String       @id @default(uuid()) @db.Uuid
  accountId String       @db.Uuid
  status    ExportStatus @default(pending)
  s3Key     String?
  expiresAt DateTime?
  createdAt DateTime     @default(now())
  account   Account      @relation(fields: [accountId], references: [id])

  @@map("data_exports")
}

model AdminUser {
  id           String    @id @default(uuid()) @db.Uuid
  email        String    @unique
  role         AdminRole
  passwordHash String
  totpSecret   String                          // encrypted at rest
  disabledAt   DateTime?
  createdAt    DateTime  @default(now())

  @@map("admin_users")
}

model AccountActionLog {
  id        String        @id @default(uuid()) @db.Uuid
  accountId String        @db.Uuid
  adminId   String        @db.Uuid
  action    AccountAction
  reason    String
  until     DateTime?                          // for suspend
  reportId  String?       @db.Uuid
  createdAt DateTime      @default(now())
  account   Account       @relation(fields: [accountId], references: [id])

  @@index([accountId])
  @@map("account_actions")
}

model AuditLog {
  id         String    @id @default(uuid()) @db.Uuid
  actorType  ActorType
  actorId    String?
  action     String                            // e.g. "admin.view_account_personas"
  targetType String?
  targetId   String?
  meta       Json?
  createdAt  DateTime  @default(now())

  @@index([targetType, targetId])
  @@index([createdAt])
  @@map("audit_logs")
}

model GrievanceTicket {
  id                 String          @id @default(uuid()) @db.Uuid
  complainantContact String
  subject            String
  body               String
  status             GrievanceStatus @default(open)
  ackDueAt           DateTime                  // createdAt + 24h
  resolveDueAt       DateTime                  // createdAt + 15d
  ackAt              DateTime?
  resolvedAt         DateTime?
  createdAt          DateTime        @default(now())

  @@index([status, ackDueAt])
  @@map("grievance_tickets")
}

model LegalRequest {
  id          String    @id @default(uuid()) @db.Uuid
  authority   String
  referenceNo String
  scope       String
  receivedAt  DateTime
  respondedAt DateTime?
  handledById String?   @db.Uuid
  notes       String?

  @@map("legal_requests")
}
```

**Kept in Redis, not Postgres:** unlock tokens, rate-limit windows, active-call lock per account, typing throttle, OTP send counters, socket adapter state.

---

## 6. Policy rules (who can reach whom)

All checks live in `packages/domain/policy`. Inputs: actor persona, target persona, (conversation), action. Output: `allow | suppress | reject(code)` plus **what each side sees**.

### 6.1 Evaluation order

1. Actor account `banned`/`suspended` → `reject(ACCOUNT_RESTRICTED)` (actor is told).
2. Actor persona retired / paused-by-billing (for sending) → `reject` (actor is told; it's their own number).
3. Target account `banned` or target persona `retired` → `reject(NUMBER_UNAVAILABLE)` — "This number is no longer available".
4. **Block between the two accounts (either direction)** → `suppress` (see 6.3).
5. Action-specific rules (6.2).

### 6.2 Action matrix

| Action | Allowed when | Otherwise (what the actor sees) |
|---|---|---|
| View public card | target active or paused | generic 404 (same for retired / never existed) |
| Send request | target active, `acceptRequests`, no pending request, not in 7-day decline cool-down, actor < 20 requests today | paused / not accepting → "Not accepting requests right now"; cool-down / cap → specific error to actor |
| Send message | conversation open, actor's member row not hidden, target persona not retired | closed → "This number is no longer available" |
| Call | message rules + callee `allowCalls` + callee not in DND + no active call on callee **account** | DND / calls off / busy → **all look like "No answer"** after ringing |
| Change retention | conversation open | — |

A **paused** persona (rule 7): no new requests; existing chats and calls continue. A **billing-paused** persona: chats readable, no sending or receiving.

### 6.3 Silent block

When account **A** blocks persona **X** (owned by account **B**) from conversation **C**:

| Path | A (blocker) sees | B (blocked) sees |
|---|---|---|
| Conversation **C** | Hidden from inbox; listed in Settings → Blocked by X's code | Counterpart shown as **"Unknown"** (no name/avatar). Their messages stay at ✓ forever. Calls ring out → "No answer". |
| Other conversations between A's and B's numbers | Normal; nothing changes visually | Normal name/avatar. Messages in both directions are **suppressed** (✓ forever, never delivered). Calls ring out. |
| New requests B → A (any numbers) | Never shown | Appears sent, stays pending |
| New requests A → B | Stored as suppressed; never shown to B | — |
| Public card of A's numbers, viewed by B | Normal card | Normal card; submitting a request is silently suppressed |

- Nothing tells either side that two numbers share an owner.
- **Unblock** stops suppression going forward. Previously suppressed messages are never delivered.
- **Report** with "also block" (default on) applies the same rules.

---

## 7. REST API contract

Base: `/v1`. JSON. Errors: `{ "error": { "code": "STRING_CODE", "message": "...", "details"?: {} } }`.

Auth: `Authorization: Bearer <access JWT>` (15 min). Refresh token in `hg_rt` cookie (httpOnly, Secure, SameSite=Strict, path `/v1/auth`).
Locked numbers: `X-Persona-Unlock: <token>[,<token>…]` (one per unlocked persona).
Pagination: `?cursor=<opaque>&limit=` → `{ items, nextCursor }`.

### 7.1 Auth

| Method | Path | Body → Response | Notes |
|---|---|---|---|
| POST | `/auth/otp/send` | `{ phone, turnstileToken }` → 204 | Always 204 (no account enumeration) |
| POST | `/auth/otp/verify` | `{ phone, code, ageConfirmed?, consentVersion?, deviceName? }` → `{ accessToken, isNewAccount }` | New accounts must send `ageConfirmed: true` + `consentVersion` |
| POST | `/auth/email/otp/send` | `{ email, turnstileToken }` → 204 | Only verified emails can log in |
| POST | `/auth/email/otp/verify` | `{ email, code, deviceName? }` → `{ accessToken }` | |
| POST | `/auth/refresh` | cookie → `{ accessToken }` | Rotates; reuse → session revoked |
| POST | `/auth/logout` | → 204 | |

### 7.2 Account (`/me`)

| Method | Path | Notes |
|---|---|---|
| GET | `/me` | Own phone (masked), email, consent version, plan summary |
| POST | `/me/email` | `{ email }` → sends verify OTP |
| POST | `/me/email/verify` | `{ code }` |
| POST | `/me/phone-change` | `{ newPhone }` → OTP to new phone |
| POST | `/me/phone-change/verify` | `{ code }` → starts 24 h cooling-off, notifies old phone |
| DELETE | `/me/phone-change` | cancel pending change |
| GET | `/me/sessions` · DELETE `/me/sessions/:id` | devices |
| POST | `/me/export` · GET `/me/export/:id` | DPDP data export (JSON, signed S3 link) |
| POST | `/me/delete/otp` · DELETE `/me` `{ code }` | account deletion |

### 7.3 Numbers (personas)

| Method | Path | Notes |
|---|---|---|
| GET | `/personas` | Own numbers + `{ used, max: 5, free: 2, paid }` |
| POST | `/personas` | `{ displayName, labelKind, labelText?, allowCalls }` → `201 persona` (free slot) or `402 { checkout }` (paid slot) |
| PATCH | `/personas/:id` | name, avatar, label, `acceptRequests`, `allowCalls`, `readReceipts`, `dndUntil`, `defaultRetention` |
| POST | `/personas/:id/avatar` | presigned upload URL |
| POST | `/personas/:id/pause` · `/resume` | |
| DELETE | `/personas/:id` | `{ confirm: "DELETE" }` → retire (irreversible) |
| GET | `/personas/:id/share` | `{ code, url, qrSvg }` |
| PUT | `/personas/:id/pin` | `{ pin, currentPin? }` set/change · DELETE to remove (needs unlock) |
| POST | `/personas/:id/unlock` | `{ pin }` → `{ unlockToken, expiresIn: 300 }` |
| POST | `/personas/:id/pin/reset/otp` · `/pin/reset` | `{ code, newPin }` → wipes own history (clearedBefore on all its conversations) |

### 7.4 Public (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/public/numbers/:code` | `{ code, displayName, avatarUrl, acceptsRequests }` — no label, no owner info; generic 404 |

### 7.5 Requests

| Method | Path | Notes |
|---|---|---|
| GET | `/requests?personaId=&status=pending|blocked&cursor=` | Incoming, per number or all |
| GET | `/requests/sent?cursor=` | Outgoing (suppressed ones look pending) |
| POST | `/requests` | `{ fromPersonaId, toCode, introMessage? }` |
| POST | `/requests/:id/accept` | → `{ conversationId }`; intro becomes first message |
| POST | `/requests/:id/decline` · `/block` | |

### 7.6 Conversations & messages

| Method | Path | Notes |
|---|---|---|
| GET | `/conversations?personaId=&label=&unread=&q=&cursor=` | Unified inbox. `q` matches nickname or display name. Locked personas → redacted rows unless unlock token present |
| GET | `/conversations/:id` | Header + settings (retention, muted, nickname, counterpart) |
| PATCH | `/conversations/:id` | `{ retention }` · `{ mutedUntil }` · `{ nickname: string \| null }` |
| POST | `/conversations/:id/clear` | Clear chat (own side) |
| GET | `/conversations/:id/messages?cursor=` | Newest first |
| POST | `/conversations/:id/messages` | `{ clientMessageId, body }` → message (✓). Idempotent on `clientMessageId` |
| POST | `/conversations/:id/read` | `{ upToMessageId }` |
| DELETE | `/messages/:id?scope=me|everyone` | everyone: sender only, ≤ 60 min |
| POST | `/messages/ack` | `{ messageIds }` → ✓✓ (used by the service worker on push) |

### 7.7 Calls

| Method | Path | Notes |
|---|---|---|
| POST | `/calls` | `{ conversationId }` → `{ callId, iceServers, iceTransportPolicy: "relay" }` |
| POST | `/calls/:id/accept` | → `{ iceServers }` |
| POST | `/calls/:id/decline` · `/end` | |
| GET | `/calls?personaId=&cursor=` | Call log (busy/suppressed shown as missed/no answer) |

### 7.8 Safety

| Method | Path | Notes |
|---|---|---|
| POST | `/blocks` | `{ fromPersonaId, conversationId? \| requestId? }` |
| GET | `/blocks` | `[{ id, blockedCode, fromCode, createdAt }]` |
| DELETE | `/blocks/:id` | unblock |
| POST | `/reports` | `{ conversationId? \| requestId?, reason, note?, alsoBlock = true }` |

### 7.9 Billing, push, grievance

| Method | Path | Notes |
|---|---|---|
| POST | `/billing/checkout` | `{ draftId }` → Razorpay subscription create / quantity update |
| POST | `/billing/webhook` | signature verified, idempotent via `WebhookEvent` |
| GET | `/billing` | subscription, invoices |
| POST / DELETE | `/push/subscribe` | Web Push subscription for this session |
| POST | `/grievance` | public form (Turnstile) |

### 7.10 Admin API (separate process, `admin.hellogram.app`)

Auth: email + password + TOTP → short session. RBAC by role. **Every read of account-level data writes `AuditLog`.**
Endpoints: reports queue & evidence, account lookup by code, account actions (warn / suspend / ban), audit log viewer, grievance tickets with SLA timers, legal request log, job dashboard (Bull Board), basic stats.

### 7.11 Error codes (excerpt)

`VALIDATION_FAILED`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `RATE_LIMITED`, `OTP_INVALID`, `OTP_EXPIRED`, `OTP_TOO_MANY_ATTEMPTS`, `AGE_CONFIRMATION_REQUIRED`, `ACCOUNT_RESTRICTED`, `PERSONA_LIMIT_REACHED`, `PERSONA_CHURN_LIMIT`, `PAYMENT_REQUIRED`, `PERSONA_LOCKED`, `PIN_INVALID`, `PIN_LOCKED_OUT`, `NUMBER_UNAVAILABLE`, `NOT_ACCEPTING_REQUESTS`, `REQUEST_COOLDOWN`, `REQUEST_DAILY_CAP`, `REQUEST_ALREADY_PENDING`, `CONVERSATION_CLOSED`, `MESSAGE_TOO_LONG`, `CALL_NOT_ALLOWED`, `FILE_TOO_LARGE`, `FILE_TYPE_NOT_ALLOWED`.

### 7.12 Serializer rules

- Other people's personas serialize **only** `{ id, code, displayName, avatarUrl }` (or `{ masked: true }` for "Unknown").
- Own personas add label, status, toggles.
- A test enumerates every route and socket event and fails if `accountId`, `phone`, `email`, another member's `nickname`, or another persona's `createdAt` appears.

---

## 8. Socket.IO contract

Namespace `/rt`, websocket transport only, auth via access token in handshake. On connect the server joins the socket to:

- `p:<personaId>` for each own active/paused persona
- `a:<opaque>` — own-devices room (server-internal id, never sent to client)

### 8.1 Server → client

| Event | Payload | Sent to |
|---|---|---|
| `message:new` | message DTO (+ conversation summary) | recipient `p:` room, sender's `a:` room (multi-device) |
| `message:delivered` | `{ conversationId, upToMessageId }` | sender |
| `message:read` | `{ conversationId, upToMessageId }` | sender (only if reader `readReceipts`) |
| `message:deleted` | `{ conversationId, messageId, scope }` | both (scope everyone) / own devices (scope me) |
| `typing` | `{ conversationId }` | counterpart (max 1 per 3 s) |
| `request:new` | request DTO | recipient |
| `request:updated` | `{ id, status }` | sender (never "blocked" — shows as pending) |
| `conversation:updated` | `{ id, retention? , closed?, masked? }` | both; nickname/mute changes → own devices only |
| `call:incoming` | `{ callId, conversationId, caller }` | callee |
| `call:accepted` / `call:declined` / `call:ended` | `{ callId, reason? }` | both (declined → caller sees "no answer") |
| `call:signal` | `{ callId, kind: "offer" \| "answer" \| "ice", data }` | the other party |
| `persona:updated` | own persona DTO | own devices |

**Locked persona redaction:** events for a locked persona carry only `{ personaId, kind: "message" \| "call" \| "request" }`. The client refetches over REST with an unlock token.

### 8.2 Client → server

| Event | Payload |
|---|---|
| `message:ack` | `{ messageIds }` → sets `deliveredAt` (✓✓) |
| `message:read` | `{ conversationId, upToMessageId }` |
| `typing` | `{ conversationId }` |
| `call:signal` | `{ callId, kind, data }` |

When the app is closed, the service worker marks messages delivered on push receipt via `POST /messages/ack { messageIds }` (REST twin of `message:ack`).

---

## 9. Voice calls

1. Caller → `POST /calls`. Policy check. Redis lock `call:acct:<accountId>` for both accounts (busy → silent no-answer).
2. Server creates `Call(ringing)`, schedules 45 s timeout job, emits `call:incoming` + push.
3. Both sides receive **TURN credentials** (coturn `use-auth-secret`, HMAC, TTL 10 min, username bound to `callId`).
4. `RTCPeerConnection({ iceServers, iceTransportPolicy: "relay" })` — no host/srflx candidates, IPs never exchanged.
5. SDP / ICE via `call:signal`. Audio only (Opus).
6. Accept → `answered`; end / timeout / decline → final status; lock released.
7. coturn: UDP 3478, TURN-TLS 443 fallback, `denied-peer-ip` for private ranges, `no-multicast-peers`, quotas per user.
8. `CallMediaProvider` interface keeps LiveKit a drop-in later.

---

## 10. Background jobs

| Job | Schedule | Rule |
|---|---|---|
| `retention.purgeContent` | every 10 min | `body = NULL, contentPurgedAt = now()` past conversation retention |
| `retention.purgeMetadata` | daily | hard-delete messages & calls older than 180 d |
| `reports.purgeEvidence` | daily | closed reports + 180 d |
| `auth.cleanup` | hourly | expired OTPs, old refresh tokens, expired sessions |
| `requests.expire` | hourly | pending → expired |
| `calls.ringTimeout` | delayed 45 s per call | → `missed` |
| `billing.lifecycle` | delayed + daily reconcile | grace → pause (7 d) → retire; reminders day 0 / 3 / 6 |
| `billing.reconcile` | daily | pull Razorpay state, fix missed webhooks |
| `phone.changeComplete` | delayed 24 h | apply phone change |
| `notify.push` / `notify.sms` / `notify.email` | on demand | retries with backoff |
| `account.export` / `account.delete` | on demand | DPDP |
| `grievance.sla` | hourly | alert on ack / resolve deadlines |
| `ops.backup` | daily | `pg_dump` → S3 |

---

## 11. Security and rate limits

| Limit | Value |
|---|---|
| OTP send | 3 / 15 min per target, 10 / hour per IP, Turnstile required |
| OTP verify | 5 attempts per challenge |
| Requests | 20 / day per account, 1 pending per pair |
| Messages | 30 / min per persona |
| Calls | 10 / 10 min per persona |
| PIN unlock | 5 wrong → 15 min lock, doubling to max 24 h |
| Public lookup | 60 / min per IP, generic 404 |
| New numbers | 3 per 7 days per account |

Also: refresh-token rotation with reuse detection · CSRF protection on cookie endpoints via a required custom header (`X-Hellogram-Client`), which cross-site pages can't send without a CORS preflight · strict CORS · Helmet · CSP on web · argon2id for PIN/refresh · salted IP hashes · pino redaction (phone, email, body, PIN, OTP, tokens, codes in URLs) · Sentry scrubbing, no session replay · webhook signature verification · encrypted backups.

---

## 12. Third-party providers

| Interface | Implementation (dev → prod) | Cost |
|---|---|---|
| `SmsProvider` | Console → MSG91 (DLT template) | ~₹0.2 / SMS |
| `EmailProvider` | Console → AWS SES | ~$0.10 / 1,000 |
| `BillingProvider` | Fake → Razorpay Subscriptions | ~2 % per payment |
| `PushProvider` | Web Push (VAPID) | free |
| `CallMediaProvider` | coturn relay | free (self-hosted) |
| Bot check | Cloudflare Turnstile | free |
| Errors | Sentry free plan | free |

---

## 13. Configuration

Validated at boot with Zod (`packages/config`). One `.env.example` per app.

`NODE_ENV`, `DATABASE_URL`, `REDIS_URL`, `JWT_ACCESS_SECRET` (HS256), `HASH_SECRET` (one secret; per-purpose HMAC keys for phone/email lookups, IPs, refresh tokens and OTP codes are derived from it), `CONSENT_VERSION`, `SESSION_TTL_DAYS`, `COOKIE_SECURE`, `OTP_BYPASS` (testing only — refused when `NODE_ENV=production`), `CODE_DIGITS` (6), `PUBLIC_BASE_URL`, `TURN_URLS`, `TURN_SHARED_SECRET`, `S3_*`, `MSG91_*`, `SES_*`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `RAZORPAY_PLAN_ID`, `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `TURNSTILE_SECRET`, `SENTRY_DSN`, `GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`, `FEATURE_MEDIA` (false).

---

## 14. Design tokens

Approximate values taken from the design images; to be fine-tuned against the source files in Phase 1. Lives in `packages/ui/tokens.ts`, exposed as CSS variables + Tailwind preset.

| Token | Dark | Light |
|---|---|---|
| `bg` | `#0B0B14` | `#F7F7FB` |
| `surface-1` | `#14141F` | `#FFFFFF` |
| `surface-2` | `#1A1A28` | `#F0F0F6` |
| `border` | `#2A2A3A` | `#E3E3EC` |
| `text` | `#F4F4F8` | `#12121A` |
| `text-muted` | `#9A9AB0` | `#5E5E72` |
| `primary` (violet) | `#7C5CFF` | `#6A48F5` |
| `gradient-primary` | `#4F8BFF → #8B5CF6 → #E056C8` | same |
| `success` / accept call | `#22C55E` | `#16A34A` |
| `warning` / paused | `#F5A524` | `#D97706` |
| `danger` / decline, block | `#EF4444` | `#DC2626` |
| label `olx` | `#F59E0B` on `#F59E0B1F` | |
| label `dating` | `#EC4899` on `#EC48991F` | |
| label `tenants` | `#3B82F6` on `#3B82F61F` | |
| label `other` | `#9A9AB0` on `#9A9AB01F` | |

Typography: **Plus Jakarta Sans** (UI), **JetBrains Mono** (number codes).
Radii: 12 px (inputs, chips), 16 px (cards), 24 px (sheets), full (buttons, avatars).
Touch targets ≥ 44 px. WCAG AA contrast. Visible focus rings. Theme follows system; toggle in Settings.

---

## 15. Deployment (MVP)

*To be finalised later.* Current recommendation: one AWS Lightsail 4 GB instance in Mumbai running `docker-compose.prod.yml` (Caddy, api, admin-api, worker, Postgres, Redis, coturn), Cloudflare in front, web + admin as static sites, nightly backups to S3. ~₹3,000–3,500 / month including SMS.

---

## 16. Open items

| # | Item | Proposed default |
|---|---|---|
| 1 | Intro message optional? | Optional; empty → "Hi, I'd like to connect." |
| 2 | Pending request expiry | 30 days |
| 3 | Locked number rows in inbox — design shows counterpart name ("Vikram · Locked"), spec says no data without unlock | Show **no name**: one row per locked number, e.g. "Dating · Locked · tap to unlock" |
| 4 | Which numbers are paused when payment lapses | Numbers marked `isPaid` (the most recently created beyond the 2 free) |
| 5 | Deleting a free number while paid ones exist | A paid number becomes free and subscription `quantity` drops by 1 |
| 6 | Forgot-PIN reset — keep chat nicknames? | Keep |
| 7 | Mobile lock screen copy says "6-digit PIN" | Update design to 4 digits |

---

## 17. As built — changes from the plan and known limits

Recorded at the end of Phase 11. Where this section differs from §1–16, this section wins.

**Behaviour decided during the build**

| Area | As built |
|---|---|
| Blocked requests | Look `pending` to the sender until their normal expiry date, then `expired`. A repeat request gets the same `409 REQUEST_ALREADY_PENDING` as any pending request. |
| Retention changes | Never suppressed, even across a block — a shared setting that silently changed would reveal the block. |
| Masked counterpart | "Unknown" also hides the persona id (the conversation id stands in), in chats and the call log. |
| PIN lock | Also required to change, share, pause, delete or re-avatar a locked number, and for its sent requests, calls log, export. |
| Phone change | `POST /me/phone-change` always answers `204`; a taken number just never receives a code (no enumeration). |
| Requests to deleted/banned numbers | Same generic `404` as a code that never existed. |
| TURN | UDP/TCP 3478; TURN-over-TLS on **5349** (443 is Caddy on a single-IP server). |
| Admin roles | Read from the database on every request (demotions apply immediately). |
| Number labels and media switch (replaces the OLX / Dating / Tenants / Other presets) | A number's label is the user's own text (`labelName`, 1–20 characters, required) plus an icon from a fixed set of 20 (`labelIcon`, `LABEL_ICONS` in packages/shared; the chip colour follows the icon). There are no preset labels — the form only hints at examples. Labels stay private to the owner. Inbox filters are the user's own distinct labels (`GET /v1/conversations?label=…`, case-insensitive). New switch `allowMedia` per number: a chat allows photos and files only when **both** numbers allow them (`mediaAllowed` on the conversation; uploads and sends otherwise get `403 MEDIA_NOT_ALLOWED`; the web app hides the paperclip). Migration `custom_labels_media` converted existing numbers: olx → "OLX" (shopping bag), dating → "Dating" (heart), tenants → "Tenants" (home), other → its text or "Other" (tag). |
| Sign-up and login (replaces OTP-only login and email login) | **Sign-up** `POST /auth/signup` (name, mobile, date of birth, gender, password, Terms) checks everything — 18+ by date of birth in IST, argon2id password hash, no plain password kept — stores it in Redis for 15 minutes and sends a code; `POST /auth/signup/verify` creates the account. Whether a number is already registered is only revealed after its owner enters the code. **Login** `POST /auth/login` (mobile + password; same generic error and timing for unknown numbers and wrong passwords; 10 tries per number per 15 minutes). A device whose `hg_dev` cookie (httpOnly, 400 days, stored as an HMAC in `trusted_devices`) has verified the mobile gets a session directly; otherwise a code is sent — only after the password is right, so nobody can trigger SMS/calls with just a number — and `POST /auth/login/verify` signs in and trusts the device. Logging out keeps the device trusted; logging it out remotely, or a password reset, forgets it. **Forgot password** `POST /auth/password/forgot` (same answer for every number) → `POST /auth/password/reset` (code + new password; every other session is revoked and every device must verify again). Firebase proofs (`idToken`) work in place of codes everywhere. Name, date of birth and gender are private to the account (`/v1/me`; name editable with `PATCH /v1/me`). Accounts created before passwords set one with "Forgot password". |
| SMS provider: 2Factor (current) | `SMS_PROVIDER=twofactor`. 2Factor makes, delivers and checks the 6-digit code: `GET /API/V1/{key}/SMS/{10-digit}/AUTOGEN[/{template}]` returns a session id (stored in `otp_challenges.providerRef`); `GET …/SMS/VERIFY/{session}/{code}` answers "OTP Matched" / "OTP Mismatch" / "OTP Expired" (judged by `Details`, since 2Factor's own examples pair "OTP Matched" with either `Status`). A mismatch is re-checked once after ~0.8 s because 2Factor can briefly reject a fresh, correct code. Without an approved SMS template the code can come as a voice call, so `/v1/auth/config` returns `otpDelivery: "call_or_sms"` and every phone-code screen says "you may get a call; if not, an SMS". The API key is in 2Factor's URL path, so URLs are never logged. Our challenge still enforces limits, 5 wrong tries, 10-minute expiry and single use. |
| SMS provider: Message Central | `SMS_PROVIDER=messagecentral` (VerifyNow). Unlike the other SMS providers, *they* generate and check the code: `POST /verification/v3/send` returns a `verificationId`, stored in `otp_challenges.providerRef`; the user's code is checked with `GET /verification/v3/validateOtp`. Our challenge row still enforces the send limits, 5 wrong attempts, 5-minute expiry and single use, and a code only works for the number it was sent to. The login token (`/auth/v1/authentication/token`, key = base64 password) is cached until shortly before its JWT expiry and refreshed once on a 401. Their "already sent" (506) becomes "wait a minute". Indian numbers only; phone-change notices are logged, not sent. |
| SMS provider: Fast2SMS | `SMS_PROVIDER=fast2sms`. Our server still generates, hashes and checks every code; Fast2SMS only delivers it. `FAST2SMS_ROUTE=otp` uses Fast2SMS's own OTP route (their sender and wording, no DLT of ours — no longer in their public docs, so availability depends on the account); `dlt` uses `POST /dev/otp/send` with our DLT template and our code. Indian numbers only. The phone-change notice isn't sent by SMS on these routes (logged only, as in Firebase mode). |
| Delete for everyone | **Either** person can delete **any** chat message (their own or the other person's) for both sides, at any time — replaces rule 19 (sender only, 60 minutes). System notices can't be deleted. Both sides see "This message was deleted"; an attached file is destroyed at once. A report's evidence is a snapshot taken when the report is filed, so messages deleted *before* a report are not in it. |
| Chat attachments | One photo or file per message (optional caption), up to 10 MB. Upload `POST /v1/conversations/:id/attachments` (raw body, `X-File-Name`), then send a message with `attachmentId`. Types are decided from file content: JPG, PNG, WebP, GIF, PDF, DOCX, XLSX, PPTX, ZIP, TXT, CSV — HTML, SVG, scripts and programs are refused. Image metadata (EXIF/GPS, XMP, comments) is stripped on the server; the web app also redraws photos (rotation baked in, max 2048 px). |
| Attachment storage | Encrypted by the API before storage: AES-256-GCM, a per-file key via HKDF from `ATTACHMENT_ENCRYPTION_KEY`, header and storage key authenticated, key id in the header for rotation. Private S3 bucket (local folder in dev), random object names, no pre-signed or public URLs. |
| Attachment access | Only `GET /v1/attachments/:id` with the access token (never a cookie or a URL token). Every request re-checks: chat member, chat not hidden, PIN lock, message visible to the caller (not suppressed by a block, not deleted for them, not cleared), and not deleted for everyone / expired. Every refusal is the same `404`. Responses are `no-store`, `nosniff`, `default-src 'none'; sandbox`; only images are served inline. The web app shows files from in-memory `blob:` URLs. |
| Attachment lifecycle | Delete for everyone destroys the object at once. Retention expiry, account deletion, the 180-day purge and uploads never sent (1 hour) are destroyed by the worker's `attachments.sweep` (every 10 min); downloads are refused from the moment the message loses its content. Files are not queued offline. Report evidence and the data export record file details only, not the file. |
| My profile | `/settings/profile`: mobile number (change with 24 h cooling-off), recovery email, sounds, devices. Reached from the sidebar profile row / kebab, the mobile avatar on My numbers, and the top of Settings. |
| Sounds | Ringtone (Classic, Chime, Marimba, Pulse, Silent), message sound (Pop, Ding, None) and vibrate — **per device** (localStorage), not synced. Tones are synthesised with Web Audio (no audio files). Ringback plays while calling out. No message sound while that chat is open and visible, or while it's muted. Browsers only play sound after the first tap/key on the page. |

**Security hardening (Phase 11 review)**

- OTP and PIN attempts are reserved atomically before comparing (parallel guesses can't exceed the limits); OTPs are single-use under concurrency.
- `trustProxy` is configured by hop count / CIDRs (`TRUST_PROXY`), never `true`, so `X-Forwarded-For` can't be forged to dodge per-IP limits.
- Production refuses console SMS/email, the payment simulator, `OTP_BYPASS`, a rate-limit multiplier ≠ 1, missing Turnstile secret, `TRUST_PROXY=false` and default secrets.
- Live sockets are disconnected on logout / remote logout / refresh-token reuse / account deletion, and re-check their session every 60 s (admin bans run in another process).
- Push endpoints are restricted to https browser push services (no SSRF). Notification jobs are deleted from Redis on completion (no lingering previews).
- Request logs mask number codes in URLs and don't log raw client IPs.

**Phone verification: Firebase Phone Auth (added after Phase 11)**

- `PHONE_AUTH_PROVIDER=firebase`: the browser sends and checks the SMS through Firebase (with its invisible reCAPTCHA). The API receives a Firebase ID token at `POST /v1/auth/firebase`, verifies it with Google's public keys (RS256, issuer/audience = `FIREBASE_PROJECT_ID`, `sign_in_provider=phone`, verified within the last 10 minutes) and signs the user in exactly like our own OTP path (18+ consent, sessions, rate limits).
- The same "phone proof" (`{ code }` or `{ idToken }`) protects PIN reset, account deletion and phone change; the token must be for the account's own (or the new) number.
- The web app deletes the Firebase user record right after getting the token, so Google keeps no user list. Firebase still processes the phone number (outside India) during verification — note this in the Privacy Policy.
- In Firebase mode the server sends no SMS (`SMS_PROVIDER=none`); the phone-change notice to the old number is skipped. DLT registration isn't needed.

**Known limits (v1)**

1. **Design-level correlation on the blocker's side.** Blocks are account-wide and silent both ways (§6.3). After blocking one of someone's numbers, the blocker can notice their *other* chats with that person go quiet (single tick, no typing, calls ring out) and infer those numbers belong to the same person — and vice versa. Fixing this needs a product decision (e.g. per-number blocks, or account-wide blocks only for new contact) rather than code.
2. **Calls on the web** ring only while the app is open or after the user taps the push notification; iOS delivers Web Push only to PWAs added to the Home Screen. Native apps (CallKit / ConnectionService) solve this later.
3. **Delivery ticks from push**: the service worker can't acknowledge delivery (it has no access token), so ✓✓ is set when the app next opens.
4. **Media** stays behind `FEATURE_MEDIA` (off).
5. **Providers pending accounts**: MSG91 (DLT templates), SMTP/SES, Razorpay and Turnstile have working adapters but need real keys; until then development uses the console providers and the payment simulator.
6. **Legal copy** in `apps/web/src/content/*.md` is placeholder text.
