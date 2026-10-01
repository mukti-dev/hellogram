# Hellogram — Runbooks

Operational procedures. Keep this file short and current; link out for detail.

---

## 1. Deploy (single server)

Target: one AWS Lightsail 4 GB instance in Mumbai (ap-south-1), Docker Compose, Cloudflare in front.

1. **Server**: Ubuntu LTS, Docker Engine + Compose plugin, firewall open for 80/443 (TCP+UDP), 3478 (TCP+UDP), 5349 (TCP), 49152–65535 (UDP, TURN relay).
2. **DNS** (Cloudflare): `hellogram.app` and `admin.hellogram.app` → server IP (proxied, orange cloud); `turn.hellogram.app` → server IP (**DNS only**, grey cloud — TURN can't go through Cloudflare).
3. **Secrets**: `cp infra/.env.production.example infra/.env.production` and fill every value
   (`openssl rand -base64 48` for `JWT_ACCESS_SECRET`, `HASH_SECRET`, `ADMIN_JWT_SECRET`, `TURN_SHARED_SECRET`).
   Put the Postgres password in `infra/secrets/postgres_password`. Set `TRUST_PROXY=1` (Caddy) and configure Caddy
   `trusted_proxies` for Cloudflare ranges so the client IP is correct.
4. **TURN**: edit `infra/coturn/turnserver.prod.conf` — `external-ip`, `static-auth-secret` (= `TURN_SHARED_SECRET`), TLS cert paths.
5. **Start**:
   ```bash
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production build
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production run --rm migrate
   docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production up -d
   ```
6. **First admin**: `docker compose … exec admin-api sh -c 'ADMIN_PASSWORD=… node dist/cli/create-admin.js you@company.com admin'`
   (or run `pnpm --filter @hellogram/admin-api create-admin` from a machine with DB access). Scan the printed TOTP URL.
7. **Verify**: `https://hellogram.app/health/ready` → `ok`; sign up with a real phone; place a test call between two networks.

The API **refuses to start** in production with `OTP_BYPASS=true`, the dev payment simulator, console SMS/email,
a loosened rate-limit multiplier, missing Turnstile secret, `TRUST_PROXY=false`, or default secrets.

### Rollback
`git checkout <previous tag>` → `docker compose … up -d --build`. Migrations are forward-only: write a new
migration to undo schema changes; never edit applied ones.

---

## 2. Backups & restore

- **Nightly**: `pg_dump` → gzip → S3 (bucket in ap-south-1, SSE-KMS, 35-day lifecycle). Cron on the host:
  ```bash
  docker compose -f infra/docker-compose.prod.yml exec -T postgres pg_dump -U hellogram hellogram | gzip | aws s3 cp - s3://hellogram-backups/pg/$(date +%F).sql.gz
  ```
- **Restore drill (monthly)**: restore the latest dump into a scratch database, run `pnpm test:int` against it, record the time taken.
- Redis holds only rate-limit counters, locks and queues — no restore needed.

---

## 3. Personal data breach (DPDP Act 2023 / Rules 2025)

Trigger: any confirmed or reasonably suspected unauthorised access to personal data.

| When | Action | Owner |
|---|---|---|
| Immediately | Contain: rotate affected secrets (`JWT_ACCESS_SECRET` logs everyone out; `HASH_SECRET` rotation needs a re-hash plan), revoke sessions (`UPDATE sessions SET "revokedAt" = now()`), block the vector | On-call engineer |
| Within 1 hour | Open an incident doc: timeline, systems, data categories, number of users, evidence preserved (don't wipe logs) | Incident lead |
| Without delay | **Notify the Data Protection Board of India** (initial intimation) and **each affected user** in plain language: what happened, likely consequences, what we're doing, what they can do | Grievance Officer + founder |
| Within 72 hours | Detailed report to the Board: facts, cause, mitigation, measures to prevent recurrence, user notifications made | Grievance Officer |
| After | Post-mortem, fixes, update this runbook | Engineering |

Keep the evidence (logs are retained 180 days, §9) and record every action in the incident doc.

---

## 4. Cyber incident — CERT-In (Directions of 28 April 2022)

Reportable incidents (e.g. targeted scanning, compromise of systems/accounts, unauthorised access, data breach/leak,
malicious code, attacks on servers/apps, DoS/DDoS) must be reported to **CERT-In within 6 hours** of noticing them.

1. Email **incident@cert-in.org.in** using the CERT-In incident reporting form (see cert-in.org.in), include: time of
   occurrence and detection, type, affected systems/IPs, symptoms, actions taken.
2. Name a **Point of Contact** with CERT-In in advance and keep it current.
3. **Logs**: security and system logs are kept for **180 days in India** (CloudWatch ap-south-1 / local volume with
   180-day retention) and must be provided to CERT-In on request.
4. **Clocks**: servers sync to NTP (Ubuntu default `systemd-timesyncd`, or NIC/NPL NTP servers).

---

## 5. Legal / law-enforcement requests (IT Rules 2021, BNSS)

1. **Log it** in Admin → Legal requests (authority, reference number, scope, received time) before doing anything else.
2. **Validate**: written request from an authorised officer, correct jurisdiction, specific scope (number codes, dates).
3. **Scope the data**: the admin lookup (audited) maps a number code → account → other numbers. Export only what is
   asked for. Message content may already be purged under the chat's retention setting; say so.
4. **Timelines**: takedown orders under the IT Rules — act within the time in the order (typically 36 hours;
   24 hours for certain content). Information requests — respond within the time stated (IT Rules: 72 hours).
5. **Respond** through the channel the request came from; record the response time in Admin → Legal requests.
6. Never reveal to the user that a request was received unless allowed by law.

---

## 6. Grievances (IT Rules 2021)

- Complaints arrive via `/grievance` → Admin → Grievances. **Acknowledge within 24 hours**, **resolve within 15 days**.
- The admin dashboard and Grievances list flag tickets past either deadline.
- The Grievance Officer's name and email are configured (`GRIEVANCE_OFFICER_NAME`, `GRIEVANCE_OFFICER_EMAIL`) and shown publicly.

---

## 7. Abuse spikes (SMS pumping, spam waves)

- **SMS cost spike**: check `hg:lim:otp:*` counters in Redis and MSG91 delivery reports; tighten the Turnstile mode
  to "managed"; temporarily lower OTP per-IP limits; block ASNs at Cloudflare.
- **Spam wave**: Admin → Reports; bulk-suspend with a shared reason; consider raising the new-number weekly limit.
- **Stuck calls**: the worker marks calls still ringing after 60 s as missed and releases the per-account call lock.
