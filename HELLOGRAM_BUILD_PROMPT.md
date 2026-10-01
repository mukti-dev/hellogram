# Hellogram — Build Prompt

> Paste this whole file into your coding agent (Claude Code, Cursor, etc.) as the project brief, or save it in the repo root as `SPEC.md` and tell the agent to follow it. Attach the two design images (mobile screens + desktop screens) alongside it.

---

## 0. Your role and how to work

You are a senior full-stack engineer building **Hellogram**, a production-grade, privacy-first chat and voice-call app. It is web-first (responsive PWA); native mobile apps come later and must reuse the shared domain code.

Rules for how you work:
- **Build in the phases listed in section 12, one phase at a time.** At the end of each phase, stop and give me a short summary (what's built, how to run it, what's tested, open questions). Wait for my go-ahead before starting the next phase.
- Before writing code in Phase 0, produce the architecture: folder structure, Prisma schema, API route list and socket event list. Wait for my approval.
- TypeScript strict mode everywhere. No `any` unless justified in a comment.
- Validate every input with Zod schemas from `packages/shared`, and use the same schemas on client and server.
- Every business rule in section 5 must have a unit or integration test.
- Never invent product behaviour. If something is unclear, ask.
- Match the attached designs closely: layout, spacing, colours, gradients, typography and component shapes.

---

## 1. Product summary

Hellogram gives users disposable **Hellogram numbers** to share instead of their real mobile number. Chat and voice calls happen app-to-app. If someone misbehaves, the user blocks them, or deletes that number and creates a new one. The real mobile number is never shown to anyone and never changes.

Target users (India first): OLX/marketplace sellers, landlords and tenants, dating, freelancers, and anyone (especially women) who doesn't want to share their real number. **18+ only.**

It is NOT an anonymous stranger-chat app. There is no discovery, search of other users, random matching or group chat. Every user is phone-verified, and the platform always knows which account owns which number.

---

## 2. Tech stack (use exactly this)

**Monorepo:** pnpm workspaces + Turborepo

```
apps/
  api/        Fastify + TypeScript (REST + Socket.IO)
  web/        React 18 + Vite + TypeScript PWA (user app, incl. public receiver web entry)
  admin/      React + Vite admin panel (separate app, separate auth)
  worker/     BullMQ workers (retention sweeps, notifications, billing jobs)
packages/
  shared/     Zod schemas, types, constants, error codes, number-format utils
  ui/         Shared React components + design tokens (web now, RN later where possible)
  config/     ESLint, TS, Tailwind presets
infra/
  docker-compose.yml   Postgres 16, Redis 7, LiveKit (dev), MinIO (S3-compatible)
```

- **DB:** PostgreSQL 16 + Prisma
- **Cache, presence, rate limits, pub/sub:** Redis (ioredis). Socket.IO uses the Redis adapter.
- **Jobs:** BullMQ
- **Realtime chat:** Socket.IO
- **Voice calls:** LiveKit (self-hosted in prod on AWS, or LiveKit Cloud). Use `livekit-server-sdk` for tokens and `@livekit/components-react` / `livekit-client` on web. Audio only.
- **OTP SMS:** MSG91 (DLT-registered template) behind an `SmsProvider` interface. A `ConsoleSmsProvider` logs the OTP in dev.
- **Email (recovery):** AWS SES behind an `EmailProvider` interface
- **Payments:** Razorpay Subscriptions (UPI Autopay + cards) behind a `BillingProvider` interface
- **Push:** Web Push (VAPID) via `web-push`
- **File storage:** S3 (MinIO locally), for avatars only in v1
- **Web UI:** Tailwind CSS, Radix UI primitives, TanStack Query, Zustand for local UI state, React Router, `vite-plugin-pwa`
- **Auth:** short-lived access JWT (15 min) + rotating refresh token (httpOnly, Secure, SameSite=Strict cookie), stored hashed in DB per device
- **Hashing:** argon2id (PINs, refresh tokens)
- **Testing:** Vitest (unit/integration against a real Postgres test DB via Docker), Playwright (E2E critical flows)
- **Observability:** pino logs (JSON), OpenTelemetry-ready, Sentry
- **Hosting target:** AWS ap-south-1 (Mumbai). All user data and logs stay in India.

Mobile later: React Native (Expo) reusing `packages/shared`. Keep business logic out of React components so it can be reused.

---

## 3. Core concepts and vocabulary

| Term | Meaning |
|---|---|
| **Account** | The real person. Owns phone number, email, sessions, billing. **Account IDs never leave the server.** |
| **Hellogram number** (`persona` in code) | A shareable identity owned by an account. Max 5 active per account. Has its own display name, avatar, label, settings, inbox. |
| **Number code** | Public identifier, format `HG-XXXX-XXXX` (display) / `HG48271935` (URL/storage). Share link: `https://hellogram.app/HG48271935`. |
| **Label** | Private tag only the owner sees: `OLX`, `Dating`, `Tenants`, `Other` (custom text allowed, ≤ 16 chars). |
| **Contact request** | The first contact from someone to a number. Carries one intro message (≤ 300 chars). Must be accepted before chat or calls. |
| **Conversation** | Always between exactly two personas (never accounts). |

**The golden rule: every client-facing API, socket event and push payload refers to persona IDs and number codes only. Never an account ID, phone number or email of another user.** Add a test that fails if any response serializer includes `accountId`, `phone` or `email` for a persona that isn't the caller's own.

---

## 4. Data model (starting point, refine in Phase 0)

```
Account          id, phone (unique, E.164), email (nullable, unique), emailVerifiedAt,
                 ageConfirmedAt, status (active|suspended|banned|deleted), createdAt, deletedAt
Session          id, accountId, deviceName, userAgent, ipHash, refreshTokenHash, createdAt, lastSeenAt, revokedAt
OtpChallenge     id, target (phone|email), purpose (login|pin_reset|email_verify), codeHash,
                 attempts, expiresAt, consumedAt
Persona          id, accountId, code (unique, NEVER reused), displayName, avatarKey, label, labelColor,
                 status (active|paused|retired), isPaid, acceptRequests (bool), allowCalls (bool),
                 readReceipts (bool), dndUntil, defaultRetention (enum), pinHash (nullable),
                 pinFailedCount, pinLockedUntil, createdAt, retiredAt
RetiredCode      code (PK)   -- guarantees codes are never reissued
ContactRequest   id, fromPersonaId, toPersonaId, introMessage, status (pending|accepted|declined|blocked|expired),
                 createdAt, respondedAt
Conversation     id, personaAId, personaBId (ordered pair, unique), retention (forever|d90|d30|d7|h24),
                 retentionChangedBy, retentionChangedAt, closedAt, createdAt
ConversationMember conversationId, personaId, clearedBefore (timestamp; hides older msgs for this side),
                 mutedUntil, lastReadMessageId
Message          id, conversationId, senderPersonaId, body (nullable after expiry/delete), type (text|system),
                 createdAt, deliveredAt, readAt, deletedForEveryoneAt, contentPurgedAt
Call             id, conversationId, callerPersonaId, calleePersonaId, livekitRoom, status
                 (ringing|answered|missed|declined|ended|failed), startedAt, answeredAt, endedAt
Block            id, blockerAccountId, blockedAccountId, createdAt   -- ACCOUNT level, hidden
Report           id, reporterPersonaId, reportedPersonaId, conversationId, reason, note, status
                 (open|reviewing|actioned|dismissed), createdAt
ReportEvidence   id, reportId, snapshot (JSONB: last 50 messages with timestamps + sender codes)
Subscription     id, accountId, personaId, provider, providerSubId, status (active|past_due|grace|cancelled),
                 currentPeriodEnd, graceUntil
Payment          id, subscriptionId, amountPaise, gstPaise, invoiceNo, providerPaymentId, paidAt
PushSubscription id, accountId, endpoint, keys, createdAt
AuditLog         id, actorType (system|admin|account), actorId, action, targetType, targetId, meta JSONB, createdAt
AdminUser        id, email, role (moderator|admin|grievance_officer), passwordHash, totpSecret
GrievanceTicket  id, complainantContact, subject, body, status, ackAt, resolvedAt, createdAt
LegalRequest     id, authority, referenceNo, scope, receivedAt, respondedAt, handledBy, notes
```

---

## 5. Business rules (each needs tests)

### Accounts and auth
1. Sign-up and login use phone OTP (6 digits, 5 min expiry, max 5 attempts, max 3 sends per 15 min per phone, and per-IP limits too). Email is optional and used only for recovery.
2. The first login requires ticking an 18+ confirmation and accepting the Terms and Privacy Policy (DPDP consent notice). Store `ageConfirmedAt` and the consent version.
3. Users can list sessions/devices and log out remotely.
4. Account deletion: all personas are retired, conversations close, and content is purged. Metadata is kept per the retention rules in section 9, then hard-deleted.

### Hellogram numbers (personas)
5. Max **5 active or paused** personas per account. The **first 2 are free**. Each extra needs an active ₹49/month subscription (Razorpay). A persona is only created after successful payment authorisation.
6. Number codes are random `HG-` + 8 digits. Avoid obviously sequential or repeated patterns. They are **never reused**: check against `Persona.code` and `RetiredCode`.
7. **Pause:** stops new requests, existing chats and calls continue. **Delete (retire):** all its conversations close, the other side sees "This number is no longer available", the code moves to `RetiredCode`, and the persona slot frees up. This cannot be undone. Require typed confirmation in the UI.
8. To stop create/delete churn from gaming limits: max 3 new personas per account per 7 days.
9. Lapsed payment: the subscription goes to `grace` → the persona is **paused for 7 days** (chats readable, no sending or receiving) → then **retired**. Send reminders at renewal failure, day 3 and day 6.

### Contact requests
10. Anyone with a number's code or link can send a request with an intro message, if `acceptRequests=true` and the persona is active. The owner can **Accept**, **Decline** or **Block**.
11. Accepting creates the conversation and posts the intro as its first message.
12. A declined sender can't request the same persona again for 7 days. Max 20 pending outgoing requests per account per day.
13. Requests never reveal to the receiver anything except the sender persona's display name, avatar and code.

### Blocking (critical)
14. A block is **account-to-account** and **silent**. When account A blocks the account behind persona X, **all** of that account's personas are blocked from all of A's personas: requests are dropped, messages are rejected, calls are rejected.
15. The blocked side sees only a generic "This number is unavailable". Never reveal that a block exists, or that two personas share an owner.
16. Blocking from a request or chat also closes that conversation for the blocker. Unblocking is possible from Settings → Blocked (shown by persona code the user blocked from).

### Chat
17. One-to-one text only in v1 (max 4,000 chars). Delivery and read ticks. Read ticks are sent only if the **reader's** persona has `readReceipts=true`.
18. Typing indicator (throttled, 1 event per 3 s).
19. Delete for me (sets it hidden for that member) and delete for everyone (within 60 minutes of sending).
20. **Presence is never exposed.** No online/last-seen, in any API or event. Anti-correlation: nothing in any payload may let a user infer that two personas share an owner (no shared timestamps, avatars URLs with account-level paths, etc.).

### Chat history retention
21. Every persona has a `defaultRetention` used for new conversations. Either member can change a conversation's retention (`forever | 90d | 30d | 7d | 24h`). Both sides get a system message: "Amit set messages to disappear after 7 days".
22. A BullMQ job runs every 10 minutes. It sets `body = NULL, contentPurgedAt = now()` for messages older than the conversation's retention. Message **rows (metadata)** stay for 180 days, then are hard-deleted.
23. "Clear chat" sets `ConversationMember.clearedBefore = now()` for that side only.

### Number lock (PIN)
24. Any persona can have a 4–6 digit PIN (argon2id hash on the server).
25. For a locked persona, the API **refuses** to return conversations, messages or requests unless the request carries a valid `X-Persona-Unlock` token. The token comes from `POST /personas/:id/unlock` with the PIN, is scoped to that persona and device, and lasts 5 minutes (sliding). The client drops it after 1 minute in the background or when the tab closes.
26. 5 wrong PINs → locked for 15 minutes. Further failures double the lock time (max 24 hours).
27. Notifications and socket events for a locked persona carry **no** sender name or message preview, only "New message" / "Incoming call".
28. **Forgot PIN:** phone OTP → `clearedBefore = now()` on **all** of that persona's conversations (the user's side only) → set a new PIN. The persona, its contacts and the other side's history remain.

### Voice calls
29. Calls are allowed only between members of an existing, non-closed conversation, when neither side has blocked the other and the **callee** persona has `allowCalls=true` and isn't in DND.
30. The API creates a LiveKit room per call and issues short-lived (2 min to join) audio-only tokens, whose identity is the persona ID. Media always goes through the LiveKit SFU, so peer IP addresses are never exchanged.
31. Ringing lasts 45 s → `missed`. Only one active call per account at a time; a second caller gets "busy", which must look identical to "no answer" so it can't reveal cross-persona activity.
32. Every call writes a `Call` row: that's the call log, and it counts as metadata for retention.

### Reporting and safety
33. Report from a chat or request: reason (harassment, spam, scam, sexual content, threat, other) plus an optional note. On submit, **snapshot the last 50 messages** of that conversation into `ReportEvidence`. The snapshot survives the retention timer and chat clearing.
34. Reporting optionally also blocks the user (checked by default).
35. Admins can warn, suspend (temporary) or ban an account. A banned account's personas all show as unavailable.

---

## 6. API surface (REST, `/v1`, refine in Phase 0)

```
POST   /auth/otp/send             { phone }                     -> 204
POST   /auth/otp/verify           { phone, code, ageConfirmed, consentVersion } -> tokens
POST   /auth/refresh              (cookie)                      -> tokens
POST   /auth/logout
GET    /me                        own account (own phone/email ok here only)
GET    /me/sessions  DELETE /me/sessions/:id
DELETE /me                        account deletion (OTP re-verify)

GET    /personas                  own personas + slot/billing summary ("3 of 5 · 2 free")
POST   /personas                  create (free slot) | returns checkout for paid slot
PATCH  /personas/:id              name, avatar, label, toggles, defaultRetention, dnd
POST   /personas/:id/pause  /resume
DELETE /personas/:id              retire (requires { confirm: "DELETE" })
POST   /personas/:id/pin          set/change PIN
POST   /personas/:id/unlock       { pin } -> unlockToken
POST   /personas/:id/pin/reset    { otp } -> wipes own history, sets new PIN
GET    /personas/:id/share        link + QR (SVG)

GET    /public/numbers/:code      public card: displayName, avatar, code, acceptsRequests (no owner info)

GET    /requests?personaId=&status=
POST   /requests                  { fromPersonaId, toCode, introMessage }
POST   /requests/:id/accept  /decline  /block

GET    /conversations?personaId=&label=&cursor=
GET    /conversations/:id/messages?cursor=
POST   /conversations/:id/messages
DELETE /messages/:id?scope=me|everyone
PATCH  /conversations/:id         { retention } | { mutedUntil }
POST   /conversations/:id/clear

POST   /calls                     { conversationId } -> { callId, livekitUrl, token }
POST   /calls/:id/accept  /decline  /end
GET    /calls?personaId=

POST   /blocks                    { personaCode }    GET /blocks    DELETE /blocks/:id
POST   /reports                   { conversationId | requestId, reason, note, alsoBlock }

POST   /billing/checkout          { personaDraft } -> Razorpay subscription
POST   /billing/webhook           (Razorpay, signature verified, idempotent)
GET    /billing                   subscriptions, invoices (GST)

POST   /push/subscribe  DELETE /push/subscribe
POST   /grievance                 public grievance form
```

**Socket.IO events** (namespace `/rt`, auth via access token; each socket joins a room per own persona):
`message:new`, `message:delivered`, `message:read`, `message:deleted`, `typing`, `request:new`, `request:updated`, `conversation:updated` (retention, closed), `call:incoming`, `call:accepted`, `call:declined`, `call:ended`, `persona:updated`. Locked personas get redacted payloads (rule 27).

---

## 7. Screens (match the attached designs)

**Mobile (≤ 768px), bottom tab bar: Inbox · Numbers · Calls · Settings**
1. **Login:** logo, "Give out a number. Keep yours private.", +91 input, Send OTP (gradient button), "Use email instead", 18+ badge + Terms/Privacy.
2. **OTP verification:** 6 boxes, auto-advance, paste support, resend timer 00:30.
3. **My numbers:** "3 of 5 numbers · 2 free", Add number, persona cards (avatar, label chip, name, mono code, status chip Active/Locked/Paused, call toggle, kebab menu), "Extra numbers ₹49/month each" upsell card.
4. **Number detail & share:** avatar, label, name (editable), big mono code + copy, QR, link + copy, Share (Web Share API) / Copy link, toggles (Accept new requests, Allow calls, Read receipts, Lock with PIN, Do not disturb), Default chat history row, Pause/Delete in the kebab menu.
5. **Add number (paywall):** label chips, display name, allow calls toggle; if free slots are used up, a price card + "Pay ₹49 & create" + UPI/Visa/Mastercard/RuPay row.
6. **Receiver web entry** (`/HG48271935`, public, works logged out): persona card, "Reach Rahul privately. Your number stays hidden too.", +91 input → OTP, intro message (0/300), Send request, trust icons. After OTP, the visitor gets an account with an auto-created first persona (they pick a name), and the request is sent from it.
7. **Inbox:** label filter chips (All + the user's labels + Unread), "N new requests · Review now" banner, conversation rows (avatar, name, "via OLX" chip, last message, time, unread badge). Locked personas' rows show a lock + "Locked · tap to unlock", with no preview.
8. **Contact requests:** Pending / Blocked tabs, request cards with Decline / Accept / Block.
9. **Chat:** header (back, avatar, name, "via OLX · HG-4827-1935", call button, kebab), retention banner ("Messages disappear after 30 days"), bubbles with ticks, composer.
10. **Chat settings:** retention radio group + "Applies to both of you. Amit will be notified.", Mute, Clear chat, Report ("Last 50 messages will be attached as evidence"), Block ("Blocks all their numbers. They'll only see 'unavailable'.").
11. **Locked number:** lock icon, "Dating is locked", PIN dots, keypad, Forgot PIN? + warning "Resetting clears this number's chat history."
12. **Incoming call:** full-screen overlay, caller avatar/name, "via OLX", "to HG-4827-1935", Decline / Accept, "Your number and location stay hidden". Plus an **in-call** screen (mute, speaker, end, timer) and an **outgoing/ringing** screen.
13. **Calls tab:** call log grouped by day, filter by number.
14. **Settings:** account (phone, recovery email), devices, blocked list, notifications, billing and invoices, privacy (download my data, delete account), help, grievance officer, Terms, Privacy.

**Desktop (≥ 1024px):** left sidebar (logo, Add number, Inbox, Numbers, Calls, Contacts, Settings, plan card "3 of 5 numbers · Manage plan", profile), then a list pane, a chat pane and a collapsible right details panel (chat settings), exactly as in the desktop design. The desktop login and OTP screens use a split hero layout.

**Design tokens** (extract exact values from the images and put them in `packages/ui/tokens.ts`):
- Dark theme first. Background near-black navy (~`#0B0B14`), surfaces ~`#14141F`/`#1A1A28`, hairline borders ~`#2A2A3A`.
- Primary gradient blue → violet → pink (~`#4F8BFF` → `#8B5CF6` → `#E056C8`) for primary buttons, logo and highlights. Violet (`#7C5CFF`) for toggles, sent bubbles and active tabs.
- Label chips: OLX amber/orange, Dating pink, Tenants blue, Other grey. Status chips: Active green, Paused amber, Locked grey.
- Danger red for Clear chat, Report, Block and Decline call; green for Accept call.
- Fonts: a geometric sans for UI (e.g. "Plus Jakarta Sans" or "Inter Tight"), monospace for number codes (e.g. "JetBrains Mono").
- 12–16 px radii, 44 px min touch targets, WCAG AA contrast, visible focus rings, full keyboard support on desktop.
- Also provide a light theme via tokens (toggle in Settings). Default to the system setting.

> Note: the designs show photo sharing in chat and a "Media, links and files" panel. **Do not build media in v1.** Render those areas as hidden behind a `FEATURE_MEDIA` flag (see Phase 10).

---

## 8. Security requirements

- Rate limits (Redis, sliding window) on OTP send/verify, request creation, message send (30/min per persona), call creation, PIN unlock and public number lookups (anti-enumeration: 60/min per IP, with generic 404s).
- Public number lookup must not reveal whether a code was retired vs never existed.
- Refresh token rotation with reuse detection (revoke the whole session family on reuse).
- CSRF protection on cookie endpoints. Strict CORS. Helmet headers. Tight CSP on web.
- Verify Razorpay webhook signatures. Webhooks must be idempotent.
- Encrypt at rest (RDS/S3 encryption). TLS everywhere.
- Store IPs only as salted hashes, except in security logs retained per section 9.
- Admin app: separate domain, email + password + TOTP 2FA, role-based access. **Every admin view of account-level data (phone, linked personas) writes an AuditLog entry.**
- No PII in logs. Pino redaction for phone, email, message body, PIN, tokens.

---

## 9. Compliance built in (India)

- **DPDP Act 2023 / DPDP Rules 2025:** consent notice at signup (versioned), data access export (JSON download), correction, erasure (account deletion), breach-response runbook stub in `/docs`.
- **IT Rules 2021:** Grievance Officer page with name and contact from config. Grievance tickets are acknowledged within 24 h and resolved within 15 days (admin SLA timers). A takedown/legal request log exists. Account ↔ persona ↔ message-origin mapping is internally traceable via the DB and audit log.
- **CERT-In 2022:** security and system logs kept for 180 days in India, plus an incident-report runbook stub.
- **Retention:** message content per the user's timer; message/call **metadata 180 days**, then hard-delete; report evidence until the report is closed + 180 days; billing records 8 years (tax).
- **18+ only**, enforced by declaration at signup.
- Pages: Terms, Privacy Policy, Grievance, Community Guidelines (content in Markdown files I'll provide; use placeholders for now).

---

## 10. Non-functional requirements

- Message delivery p95 < 300 ms within the same region. The inbox loads in < 1 s on 4G.
- Cursor-based pagination everywhere. DB indexes on all foreign keys and on `(conversationId, createdAt)`.
- The API is stateless and horizontally scalable (Socket.IO Redis adapter, sticky sessions not required, use websocket transport).
- PWA: installable, offline shell, queued outgoing messages retried on reconnect. Push notifications work when the tab is closed.
- i18n-ready (English first; Hindi and Odia later). All strings in locale files.
- Accessibility: semantic HTML, ARIA on custom controls, screen-reader labels on icon buttons.

---

## 11. Local dev and delivery

- `pnpm dev` starts everything. `docker compose up` for Postgres, Redis, MinIO and LiveKit.
- `.env.example` for every app. Validate config at boot with Zod.
- Seed script: 3 demo accounts with personas, requests, conversations and a call log matching the design data (Rahul Deals/OLX, Coffee Chats/Dating, Rental Enquiries/Tenants, Amit Kumar, Sneha R, Priya Singh…).
- GitHub Actions: lint, typecheck, unit/integration tests, Playwright E2E, build.
- Dockerfiles for api, worker, web (static, served via S3 + CloudFront) and admin.
- `docs/ARCHITECTURE.md`, `docs/RUNBOOKS.md` (breach, CERT-In incident, legal request), and a README.

---

## 12. Build phases (stop and report after each)

| Phase | Scope | Done when |
|---|---|---|
| **0. Architecture** | Folder tree, full Prisma schema, API + socket contract, tokens file. **No feature code yet.** | I approve it |
| **1. Foundation** | Monorepo, Docker, config, Prisma migrate, Fastify skeleton, error handling, logging, rate-limit plugin, UI kit + tokens, app shell (mobile tabs + desktop sidebar), light/dark | `pnpm dev` runs, shell renders like the design |
| **2. Auth** | Phone OTP (console provider), 18+ + consent, JWT/refresh, sessions, devices screen, desktop + mobile login/OTP screens | E2E: sign up → land on My numbers |
| **3. Numbers** | Persona CRUD, 2-free limit, code generation, never-reuse, pause/resume/retire, share link + QR, number detail screen, churn limit | Tests for rules 5–8 pass |
| **4. Requests + receiver web entry** | Public `/HG…` page, OTP-from-link signup, requests inbox, accept/decline/block, cool-downs | E2E: stranger opens link → sends request → owner accepts |
| **5. Chat (realtime)** | Conversations, messages, ticks, typing, delete, inbox filters, unified inbox, offline queue | Two browsers chat live |
| **6. Safety** | Account-level silent block, reports + evidence snapshot, retention setting + sweeper job, clear chat, anti-correlation tests | Tests for rules 14–23, 33–34 pass |
| **7. PIN lock** | Set/change PIN, unlock tokens, server-side enforcement, lockouts, forgot-PIN wipe, redacted events | Tests for rules 24–28 pass |
| **8. Voice calls** | LiveKit integration, incoming/outgoing/in-call screens, call log, busy/missed handling | Two browsers can call; blocked/disallowed calls rejected |
| **9. Billing + notifications** | Razorpay subscriptions, paywall screen, webhooks, grace → pause → retire, GST invoices, Web Push (redacted for locked) | Paid 3rd number flow works in Razorpay test mode |
| **10. Admin + compliance** | Admin app (reports queue, account actions, audit log, grievance SLA, legal request log, dashboard), data export, account deletion, legal pages, metadata purge jobs | All section 9 items exist |
| **11. Hardening** | Security review against section 8, load test (k6) for chat + sockets, accessibility pass, Lighthouse PWA ≥ 90, production Dockerfiles, CI green | Ready for staging |

Later (don't build now, but don't block): media sharing with CSAM hash-scanning (`FEATURE_MEDIA`), auto-expiring numbers, quick replies/away messages, export chat as PDF evidence, hidden numbers, React Native apps with CallKit/ConnectionService + VoIP push, business numbers, video calls.

---

**Start with Phase 0 now.**
