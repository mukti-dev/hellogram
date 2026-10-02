# Hellogram — Runbooks

Operational procedures. Keep this file short and current; link out for detail.

---

## 1. Deploy (single server, nginx)

Target: one AWS Lightsail instance in Mumbai (ap-south-1), Docker Compose, nginx in front.

| Address | What | Served by |
|---|---|---|
| `https://hellogram.in` | Landing page (+ `hellogram.in/A482719K` share links → the app) | nginx, `apps/site` |
| `https://app.hellogram.in` | Web app; `/v1`, `/socket.io`, `/media` → API | nginx → `api:4000` |
| `https://admin.hellogram.in` | Admin panel (allow-listed IPs only); `/admin/v1` → admin API | nginx → `admin-api:4100` |
| `turn.hellogram.in` | Call relay, ports 3478 / 5349 | coturn (host network) |

**How deploys work**: every push to `main` runs CI (`.github/workflows/ci.yml`: lint, typecheck, unit, integration,
browser tests). If it passes, GitHub builds the five images (`infra/docker/docker-bake.hcl`), pushes them to
`ghcr.io/mukti-dev/hellogram/*` tagged with the commit SHA, then `deploy.yml` connects to the server over SSH, uploads
the compose file and scripts, and runs `infra/server/deploy.sh`: pull → migrate → restart → health check. The server
never builds anything.

### One-time setup

1. **Lightsail instance**: Ubuntu 24.04, region Mumbai, 2 GB plan or larger. Attach a **static IP**. In
   *Networking → IPv4 firewall* allow: SSH 22, HTTP 80, HTTPS 443, TCP+UDP 3478, TCP 5349, UDP 49152–65535.
2. **Deploy key** (on your computer): `ssh-keygen -t ed25519 -f hellogram-deploy -C github-actions -N ""`.
3. **Prepare the server**:
   ```bash
   scp infra/server/setup-ubuntu.sh ubuntu@<static-ip>:
   ssh ubuntu@<static-ip> "sudo bash setup-ubuntu.sh \"$(cat hellogram-deploy.pub)\""
   ```
   Installs Docker, a `deploy` user with that key, firewall, 2 GB swap, automatic security updates, SSH keys-only,
   log rotation, nightly database backups (`/opt/hellogram/backups`, 7 days) and the weekly call-relay restart.
4. **DNS** — A records to the static IP: `hellogram.in`, `www`, `app`, `admin`, `turn`. With Cloudflare, `turn`
   must be **DNS only** (grey cloud).
5. **GitHub** → repository *Settings*:
   - *Environments → New environment* `production` (optionally add yourself as a required reviewer to approve
     each deploy), with **secrets**:
     `SSH_HOST` (static IP), `SSH_USER` (`deploy`), `SSH_PRIVATE_KEY` (contents of `hellogram-deploy`),
     `SSH_KNOWN_HOSTS` (output of `ssh-keyscan -t ed25519 <static-ip>` — pins the server's identity).
   - *Secrets and variables → Actions → Variables*: `APP_DOMAIN` = `app.hellogram.in`; and if used,
     `VITE_PHONE_AUTH`, `VITE_FIREBASE_API_KEY`, `VITE_FIREBASE_AUTH_DOMAIN`, `VITE_FIREBASE_PROJECT_ID`,
     `VITE_FIREBASE_APP_ID`, `VITE_TURNSTILE_SITE_KEY` (public browser values, baked into the web image).
6. **First push to `main`** — CI builds and pushes the images; the deploy uploads the config files to
   `/opt/hellogram/infra` and stops, listing what's missing (expected the first time).
7. **On the server** (`ssh deploy@<static-ip>`, then `cd /opt/hellogram`):
   ```bash
   cp infra/.env.production.example infra/.env.production    # fill every value (TURN_EXTERNAL_IP = static IP)
   openssl rand -hex 24 > infra/secrets/postgres_password      # use the same password inside DATABASE_URL
   cp infra/nginx/admin-allowlist.conf.example infra/nginx/admin-allowlist.conf   # your office/VPN IPs
   sh infra/nginx/init-certs.sh                                # first HTTPS certificate (DNS must be live)
   ```
   Secrets: `openssl rand -base64 48` for `JWT_ACCESS_SECRET`, `HASH_SECRET`, `ADMIN_JWT_SECRET`, `TURN_SHARED_SECRET`;
   `openssl rand -base64 32` for `ATTACHMENT_ENCRYPTION_KEY`. Keep `TRUST_PROXY=1`.
8. **Deploy again**: *Actions → Deploy → Run workflow* with the latest commit SHA (or push any commit).
9. **First admin**: `ssh deploy@<static-ip>`, then
   `cd /opt/hellogram && docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production exec admin-api sh -c 'ADMIN_PASSWORD=… node dist/cli/create-admin.js you@company.com admin'`
   and scan the QR code it prints.
10. **Third-party settings**: Firebase (if used) → Authorized domains: `app.hellogram.in`. Turnstile → hostname
    `app.hellogram.in`. Razorpay → webhook `https://app.hellogram.in/v1/billing/webhook`.
11. **Verify**: `https://hellogram.in` → landing page, **Sign in** opens the app; `https://hellogram.in/<code>` opens
    a number; `https://admin.hellogram.in` only from an allow-listed IP; sign up with a real phone; test call
    between two networks.

### Everyday
- **Deploy**: merge or push to `main`. Pull requests run the same checks and build the images without deploying.
- **Roll back**: *Actions → Deploy → Run workflow* → the commit SHA of an earlier successful run (images are
  kept in GitHub's registry; the server keeps ~10 days locally).
- **Logs**: `docker compose -f infra/docker-compose.prod.yml --env-file infra/.env.production logs -f api`.
- **Build images by hand** (no CI): `docker buildx bake -f infra/docker/docker-bake.hcl`, or add
  `-f infra/docker-compose.build.yml` to the compose command and run `build`.

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

---

## 8. Chat attachments (S3 + encryption key)

Photos and files are encrypted by the API (AES-256-GCM, one key per file derived from `ATTACHMENT_ENCRYPTION_KEY`)
**before** upload, stored under random names, and served only by `GET /v1/attachments/:id` after the access checks.
S3 never holds anything readable, and no public or pre-signed link is ever created.

### One-time S3 setup (AWS console, region ap-south-1 / Mumbai)

1. **Create the bucket** — S3 → Create bucket.
   - Name: e.g. `hellogram-attachments-prod` (globally unique). Region: **Asia Pacific (Mumbai) ap-south-1**.
   - Object Ownership: **ACLs disabled**.
   - **Block all public access: ON** (all four boxes).
   - Bucket Versioning: **Disabled** — with versioning on, a "deleted" file would survive as an old version and
     disappearing messages would not really disappear.
   - Default encryption: **SSE-S3**. (A second layer; the real protection is our own key.)
2. **Bucket policy** (Permissions → Bucket policy) — refuse anything not over TLS:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Sid": "DenyInsecureTransport",
       "Effect": "Deny",
       "Principal": "*",
       "Action": "s3:*",
       "Resource": ["arn:aws:s3:::hellogram-attachments-prod", "arn:aws:s3:::hellogram-attachments-prod/*"],
       "Condition": { "Bool": { "aws:SecureTransport": "false" } }
     }]
   }
   ```
3. **Lifecycle rule** (Management → Create lifecycle rule, whole bucket): "Delete expired object delete markers or
   incomplete multipart uploads" → abort incomplete multipart uploads after **1 day**. Do **not** add an expiry rule
   for objects: the worker deletes files when their message goes.
4. **IAM policy** (IAM → Policies → Create → JSON), name `hellogram-attachments-rw` — objects only, no listing:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [{
       "Effect": "Allow",
       "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
       "Resource": "arn:aws:s3:::hellogram-attachments-prod/att/*"
     }]
   }
   ```
5. **Credentials**
   - Lightsail (no instance roles): IAM → Users → Create user `hellogram-api` (no console access) → attach the policy
     → Security credentials → Create access key ("Application running outside AWS") → put the two values in
     `S3_ACCESS_KEY_ID` / `S3_SECRET_ACCESS_KEY`.
   - EC2: attach the policy to the instance role and leave both variables empty.
6. **Encryption key**: `openssl rand -base64 32` → `ATTACHMENT_ENCRYPTION_KEY`. Store a copy in a password manager
   or AWS Secrets Manager, **separate from the server and from S3**. If the key is lost, every stored file is
   unreadable for good; if it leaks *together with* bucket access, files can be read.
7. **Environment** (`infra/.env.production`, used by both `api` and `worker`):
   ```
   ATTACHMENT_STORAGE=s3
   ATTACHMENT_ENCRYPTION_KEY=<from step 6>
   S3_BUCKET=hellogram-attachments-prod
   S3_REGION=ap-south-1
   S3_ACCESS_KEY_ID=<step 5>
   S3_SECRET_ACCESS_KEY=<step 5>
   ```
   The API and worker refuse to start in production without S3 and a non-default key.
8. **Verify**: send a photo in a chat, then open the object in the S3 console — it must be a file with a random name
   that starts with `HGF` and shows no image. Delete the message for everyone → the object disappears.

### Rotating the encryption key
Generate a new key, move the current one into `ATTACHMENT_ENCRYPTION_KEYS_OLD` (comma-separated), set the new one as
`ATTACHMENT_ENCRYPTION_KEY`, restart `api` and `worker`. New files use the new key; older files stay readable while
their key is in the OLD list. Remove an old key only when no chat can still hold files from that period.

### If something goes wrong
- *Downloads fail with 500 after a deploy*: the key changed without keeping the old one → restore it in `..._KEYS_OLD`.
- *S3 outage*: uploads and downloads fail, chats keep working. Deleted/expired files stay in S3 until the
  `attachments.sweep` job (every 10 minutes) succeeds again — it retries by itself.
- *Suspected key leak*: rotate (above), rotate the IAM access key, and treat it as a personal data breach (§3).
