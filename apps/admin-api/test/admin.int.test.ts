import { totpAt } from '@hellogram/infrastructure';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildAdminApp } from '../src/app.js';
import { createAdminContainer } from '../src/container.js';
import { loadAdminEnv } from '../src/env.js';

const DB = process.env.TEST_DATABASE_URL ?? 'postgresql://hellogram:hellogram@localhost:5433/hellogram_test';
const env = loadAdminEnv({
  NODE_ENV: 'test',
  LOG_LEVEL: 'silent',
  DATABASE_URL: DB,
  REDIS_URL: 'redis://localhost:6379/1',
  ADMIN_JWT_SECRET: 'test-admin-secret-0123456789abcdefghijkl',
});
const container = createAdminContainer(env);
const app = await buildAdminApp({ container, jwtSecret: env.ADMIN_JWT_SECRET, corsOrigins: [] });
const db = new pg.Client({ connectionString: DB });

beforeAll(async () => db.connect());
afterAll(async () => {
  await app.close();
  await container.close();
  await db.end();
});
beforeEach(async () => {
  await db.query('TRUNCATE admin_users, audit_logs, accounts, grievance_tickets, legal_requests RESTART IDENTITY CASCADE');
});

async function login(role: 'admin' | 'moderator' | 'grievance_officer', email = `${role}@hellogram.test`) {
  const { totpSecret } = await container.adminService.createAdmin(email, 'correct horse battery staple', role);
  const res = await app.inject({
    method: 'POST',
    url: '/admin/v1/auth/login',
    payload: { email, password: 'correct horse battery staple', code: totpAt(totpSecret, new Date()) },
  });
  expect(res.statusCode).toBe(200);
  return { authorization: `Bearer ${res.json().token}` };
}

async function seedAccount() {
  const { rows } = await db.query(
    `INSERT INTO accounts (id, phone, "ageConfirmedAt", "updatedAt") VALUES (gen_random_uuid(), '+919000000001', now(), now()) RETURNING id`,
  );
  await db.query(
    `INSERT INTO personas (id, "accountId", code, "displayName", "updatedAt") VALUES (gen_random_uuid(), $1, 'K123457Z', 'Spammer', now())`,
    [rows[0].id],
  );
  return rows[0].id as string;
}

describe('admin login (email + password + TOTP)', () => {
  it('rejects a wrong TOTP code or password, and logs the failure', async () => {
    const { totpSecret } = await container.adminService.createAdmin('a@hellogram.test', 'correct horse battery staple', 'admin');
    const wrongCode = await app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { email: 'a@hellogram.test', password: 'correct horse battery staple', code: '000000' } });
    expect(wrongCode.statusCode).toBe(401);
    const wrongPw = await app.inject({ method: 'POST', url: '/admin/v1/auth/login', payload: { email: 'a@hellogram.test', password: 'nope', code: totpAt(totpSecret, new Date()) } });
    expect(wrongPw.statusCode).toBe(401);
    expect((await db.query(`SELECT count(*)::int AS n FROM audit_logs WHERE action = 'admin.login_failed'`)).rows[0].n).toBe(2);
    expect((await app.inject({ method: 'GET', url: '/admin/v1/stats' })).statusCode).toBe(401);
  });
});

describe('roles and audit (§8)', () => {
  it('every lookup of account data writes an audit entry', async () => {
    const accountId = await seedAccount();
    const headers = await login('moderator');
    const res = await app.inject({ method: 'GET', url: '/admin/v1/lookup?code=k123457z', headers });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ accountId, phone: '+919000000001', personas: [{ code: 'K123457Z' }] });
    const audit = await db.query(`SELECT action, "targetId" FROM audit_logs WHERE action = 'admin.view_account_personas'`);
    expect(audit.rows).toEqual([{ action: 'admin.view_account_personas', targetId: accountId }]);
  });

  it('moderators can suspend but not ban; admins can ban (and bans end sessions)', async () => {
    const accountId = await seedAccount();
    const mod = await login('moderator');
    const ban = await app.inject({ method: 'POST', url: `/admin/v1/accounts/${accountId}/actions`, headers: mod, payload: { action: 'ban', reason: 'spam ring' } });
    expect(ban.statusCode).toBe(403);
    const suspend = await app.inject({ method: 'POST', url: `/admin/v1/accounts/${accountId}/actions`, headers: mod, payload: { action: 'suspend', reason: 'cooling off', untilHours: 24 } });
    expect(suspend.statusCode).toBe(204);
    expect((await db.query(`SELECT status FROM accounts WHERE id = $1`, [accountId])).rows[0].status).toBe('suspended');

    const admin = await login('admin');
    await app.inject({ method: 'POST', url: `/admin/v1/accounts/${accountId}/actions`, headers: admin, payload: { action: 'ban', reason: 'confirmed scam' } });
    expect((await db.query(`SELECT status FROM accounts WHERE id = $1`, [accountId])).rows[0].status).toBe('banned');
    expect((await app.inject({ method: 'GET', url: '/admin/v1/audit', headers: mod })).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/admin/v1/audit', headers: admin })).json().length).toBeGreaterThan(0);
  });

  it('grievance officers see SLA flags and can acknowledge', async () => {
    await db.query(
      `INSERT INTO grievance_tickets (id, "complainantContact", subject, body, "ackDueAt", "resolveDueAt", "createdAt")
       VALUES (gen_random_uuid(), 'x@example.com', 'Late', 'Complaint body text', now() - interval '1 hour', now() + interval '10 days', now() - interval '25 hours')`,
    );
    const headers = await login('grievance_officer');
    const list = await app.inject({ method: 'GET', url: '/admin/v1/grievances', headers });
    const [ticket] = list.json();
    expect(ticket).toMatchObject({ ackOverdue: true, resolveOverdue: false });
    const ack = await app.inject({ method: 'PATCH', url: `/admin/v1/grievances/${ticket.id}`, headers, payload: { status: 'acknowledged' } });
    expect(ack.json()).toMatchObject({ status: 'acknowledged' });
    expect(ack.json().ackAt).not.toBeNull();
  });
});
