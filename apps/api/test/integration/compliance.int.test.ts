import type { InboxDto, OwnPersonaDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair, sendMessage } from './fixtures.js';
import { createHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

describe('DPDP data export', () => {
  it('returns my data — my numbers, chats I can see — and nobody else’s phone', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await sendMessage(visitor, conversationId, 'hello there');
    const res = await owner.request<Record<string, unknown>>({ method: 'GET', url: '/v1/me/export' });
    expect(res.status).toBe(200);
    expect(String(res.headers['content-disposition'])).toContain('hellogram-data-');
    const data = res.body as { account: { phone: string }; numbers: unknown[]; conversations: { messages: { body: string }[] }[] };
    expect(data.numbers).toHaveLength(1);
    expect(data.conversations[0]?.messages.map((m) => m.body)).toContain('hello there');
    const visitorPhone = (await h.db.query(`SELECT phone FROM accounts WHERE phone <> $1`, [data.account.phone])).rows[0].phone;
    expect(JSON.stringify(data)).not.toContain(visitorPhone);
  });
});

describe('account deletion (rule 4)', () => {
  it('needs an OTP, switches the account off at once and erases it after 30 days', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);
    await sendMessage(owner, conversationId, 'my secret message');

    // (The harness runs with OTP_BYPASS, so only the code format is checked here.)
    const badCode = await owner.request({ method: 'DELETE', url: '/v1/me', payload: { code: 'abc', confirm: 'DELETE' } });
    expect(badCode.status).toBe(400);
    const noConfirm = await owner.request({ method: 'DELETE', url: '/v1/me', payload: { code: '123456', confirm: 'yes' } });
    expect(noConfirm.status).toBe(400);
    await owner.request({ method: 'POST', url: '/v1/me/delete/otp' });
    const res = await owner.request({ method: 'DELETE', url: '/v1/me', payload: { code: '123456', confirm: 'DELETE' } });
    expect(res.status).toBe(204);

    // Sessions are gone; the number can't be reached (like a banned account, the chat itself stays open).
    expect((await owner.request({ method: 'GET', url: '/v1/me' })).status).toBe(401);
    expect((await sendMessage(visitor, conversationId, 'still there?')).body.error?.code).toBe('NUMBER_UNAVAILABLE');
    // Nothing is erased for 30 days.
    expect((await h.db.query(`SELECT status FROM accounts WHERE status = 'pending_deletion'`)).rowCount).toBe(1);
    expect(await h.container.complianceService.eraseDueAccounts()).toBe(0);
    const kept = await h.db.query(`SELECT body FROM messages WHERE "senderPersonaId" = $1 AND type = 'text'`, [ownerNumber.id]);
    expect(kept.rows.map((r) => r.body)).toContain('my secret message');

    await h.db.query(`UPDATE accounts SET "deletedAt" = now() - interval '31 days' WHERE status = 'pending_deletion'`);
    expect(await h.container.complianceService.eraseDueAccounts()).toBe(1);
    // Erased: the chat is closed for good.
    expect(((await visitor.request<InboxDto>({ method: 'GET', url: '/v1/conversations' })).body.items[0])?.unavailable).toBe(true);
    const purged = await h.db.query(`SELECT body FROM messages WHERE "senderPersonaId" = $1 AND type = 'text'`, [ownerNumber.id]);
    expect(purged.rows.every((r) => r.body === null)).toBe(true);
    expect((await h.db.query(`SELECT 1 FROM retired_codes WHERE code = $1`, [ownerNumber.code])).rowCount).toBe(1);
    const acct = await h.db.query(`SELECT status, phone, email FROM accounts WHERE status = 'deleted'`);
    expect(acct.rows[0]).toMatchObject({ status: 'deleted', email: null });
    expect(acct.rows[0].phone).toMatch(/^deleted:/);
  });

  it('logging in within 30 days keeps the account', async () => {
    const phone = '9866666666';
    const user = await h.signUp(phone);
    const number = await user.request<OwnPersonaDto>({ method: 'POST', url: '/v1/personas', payload: { displayName: 'Mine', labelName: 'OLX', labelIcon: 'shopping-bag', allowCalls: true } });
    await user.request({ method: 'POST', url: '/v1/me/delete/otp' });
    expect((await user.request({ method: 'DELETE', url: '/v1/me', payload: { code: '123456', confirm: 'DELETE' } })).status).toBe(204);

    const back = await h.signUp(phone); // logs in: the number already has an account
    expect((await back.request<{ items: { id: string }[] }>({ method: 'GET', url: '/v1/personas' })).body.items.map((p) => p.id)).toEqual([number.body.id]);
    expect((await h.db.query(`SELECT status, "deletedAt" FROM accounts WHERE phone = $1`, [`+91${phone}`])).rows[0]).toMatchObject({ status: 'active', deletedAt: null });
    expect(await h.container.complianceService.eraseDueAccounts()).toBe(0);
  });
});

describe('phone change (24 h cooling-off)', () => {
  it('OTP to the new number → applied after 24 h; the old number can cancel', async () => {
    const user = await h.signUp('9811111111');
    expect((await user.request({ method: 'POST', url: '/v1/me/phone-change', payload: { newPhone: '9822222222' } })).status).toBe(204);
    const verify = await user.request<{ effectiveAt: string }>({
      method: 'POST',
      url: '/v1/me/phone-change/verify',
      payload: { newPhone: '9822222222', code: '123456' },
    });
    expect(verify.status).toBe(200);
    expect(new Date(verify.body.effectiveAt).getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);

    expect(await h.container.complianceService.applyDuePhoneChanges()).toBe(0);
    await h.db.query(`UPDATE phone_changes SET "effectiveAt" = now() - interval '1 minute'`);
    expect(await h.container.complianceService.applyDuePhoneChanges()).toBe(1);
    expect((await user.request<{ phone: string }>({ method: 'GET', url: '/v1/me' })).body.phone).toBe('+919822222222');
  });

  it('refuses a number that already has an account — but only after the code step, so it can’t be probed', async () => {
    await h.signUp('9833333333');
    const user = await h.signUp('9844444444');
    const start = await user.request({ method: 'POST', url: '/v1/me/phone-change', payload: { newPhone: '9833333333' } });
    expect(start.status).toBe(204);
    const verify = await user.request({ method: 'POST', url: '/v1/me/phone-change/verify', payload: { newPhone: '9833333333', code: '123456' } });
    expect(verify.status).toBe(409);
  });
});

describe('grievances (IT Rules 2021)', () => {
  it('anyone can file one; SLA: acknowledge in 24 h, resolve in 15 days', async () => {
    const officer = await h.app.inject({ method: 'GET', url: '/v1/legal/grievance-officer' });
    expect(officer.json()).toHaveProperty('email');
    const res = await h.app.inject({
      method: 'POST',
      url: '/v1/grievance',
      payload: { contact: 'someone@example.com', subject: 'Harassment', body: 'A user keeps contacting me from new numbers.' },
    });
    expect(res.statusCode).toBe(201);
    const { ackDueAt, resolveDueAt } = res.json();
    expect(Math.round((new Date(ackDueAt).getTime() - Date.now()) / 3_600_000)).toBe(24);
    expect(Math.round((new Date(resolveDueAt).getTime() - Date.now()) / 86_400_000)).toBe(15);
  });
});

describe('deleted numbers stay deleted', () => {
  it('a re-registered phone starts fresh', async () => {
    const user = await h.signUp('9855555555');
    await user.request<OwnPersonaDto>({ method: 'POST', url: '/v1/personas', payload: { displayName: 'Old', labelName: 'OLX', labelIcon: 'shopping-bag', allowCalls: true } });
    await user.request({ method: 'POST', url: '/v1/me/delete/otp' });
    await user.request({ method: 'DELETE', url: '/v1/me', payload: { code: '123456', confirm: 'DELETE' } });
    await h.db.query(`UPDATE accounts SET "deletedAt" = now() - interval '31 days' WHERE status = 'pending_deletion'`);
    await h.container.complianceService.eraseDueAccounts();
    const again = await h.signUp('9855555555');
    expect((await again.request<{ items: unknown[] }>({ method: 'GET', url: '/v1/personas' })).body.items).toEqual([]);
  });
});
