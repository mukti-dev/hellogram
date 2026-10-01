import type { OwnPersonaDto, PersonaListDto } from '@hellogram/shared';
import { createHmac } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair, createNumber, sendMessage } from './fixtures.js';
import { createHarness, type Harness, type User } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

type Checkout = { checkout: { draftId: string; provider: string; payload: Record<string, unknown> } };

async function buyThird(user: User, name = 'Paid One') {
  const res = await user.request<Checkout>({ method: 'POST', url: '/v1/personas', payload: { displayName: name, labelKind: 'tenants', allowCalls: true } });
  expect(res.status).toBe(402);
  const confirm = await user.request<{ personaId: string }>({
    method: 'POST',
    url: '/v1/billing/dev/confirm',
    payload: { draftId: res.body.checkout.draftId },
  });
  return confirm.body.personaId;
}

const numbers = async (u: User) => (await u.request<PersonaListDto>({ method: 'GET', url: '/v1/personas' })).body;
type Billing = { subscription: { status: string; quantity: number; monthlyAmountPaise: number } | null; invoices: { invoiceNo: string; amountPaise: number; gstPaise: number }[] };
const billing = async (u: User) => (await u.request<Billing>({ method: 'GET', url: '/v1/billing' })).body;

describe('paid numbers (rules 5, 9)', () => {
  it('third number: checkout → payment → paid number, GST invoice, active subscription', async () => {
    const user = await h.signUp();
    await createNumber(user, 'Free One');
    await createNumber(user, 'Free Two');
    const personaId = await buyThird(user);
    expect(personaId).toBeTruthy();

    const list = await numbers(user);
    expect(list.plan).toEqual({ used: 3, max: 5, free: 2, paid: 1, freeLeft: 0 });
    expect(list.items.find((p) => p.id === personaId)).toMatchObject({ isPaid: true, displayName: 'Paid One' });

    const b = await billing(user);
    expect(b.subscription).toMatchObject({ status: 'active', quantity: 1, monthlyAmountPaise: 4900 });
    expect(b.invoices).toEqual([expect.objectContaining({ amountPaise: 4900, gstPaise: 747 })]);
    expect(b.invoices[0]!.invoiceNo).toMatch(/^HG\/\d{4}-\d{2}\/\d{6}$/);
  });

  it('with an active mandate, the next paid number is created immediately and quantity goes up', async () => {
    const user = await h.signUp();
    await createNumber(user, 'A');
    await createNumber(user, 'B');
    await buyThird(user);
    await h.db.query(`UPDATE personas SET "createdAt" = now() - interval '8 days'`); // stay under 3 new per week
    const fourth = await user.request<OwnPersonaDto>({ method: 'POST', url: '/v1/personas', payload: { displayName: 'D', labelKind: 'olx', allowCalls: true } });
    expect(fourth.status).toBe(201);
    expect(fourth.body).toMatchObject({ displayName: 'D', isPaid: true });
    expect((await billing(user)).subscription?.quantity).toBe(2);
    expect((await numbers(user)).plan.paid).toBe(2);
  });

  it('failed renewal → 7-day grace: paid numbers pause (can’t send) → renewal resumes them', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    // Visitor already has 1 free number from the pair; make its chat number the paid one.
    await createNumber(visitor, 'Second free');
    const paidId = await buyThird(visitor, 'Paid chat');
    await h.db.query(`UPDATE personas SET "isPaid" = false WHERE id = $1`, [paidId]);
    await h.db.query(
      `UPDATE personas SET "isPaid" = true WHERE id = (SELECT "personaId" FROM conversation_members WHERE "conversationId" = $1 AND "personaId" <> (SELECT "personaId" FROM conversation_members cm JOIN personas p ON p.id = cm."personaId" WHERE cm."conversationId" = $1 AND p."displayName" = 'Rahul Deals'))`,
      [conversationId],
    );

    await visitor.request({ method: 'POST', url: '/v1/billing/dev/fail' });
    expect((await billing(visitor)).subscription?.status).toBe('grace');
    const paused = (await numbers(visitor)).items.find((p) => p.displayName === 'Amit Kumar') as OwnPersonaDto;
    expect(paused).toMatchObject({ status: 'paused', pauseReason: 'billing' });
    expect((await sendMessage(visitor, conversationId, 'hi')).body.error?.code).toBe('NUMBER_PAUSED');
    // Can't self-resume a billing pause.
    expect((await visitor.request({ method: 'POST', url: `/v1/personas/${paused.id}/resume` })).status).toBe(409);
    // The other side's messages to a billing-paused number are silently held (one tick).
    expect((await sendMessage(owner, conversationId, 'hello?')).body.status).toBe('sent');

    // Renewal succeeds → everything resumes.
    const sub = await h.db.query(`SELECT "providerSubId" FROM subscriptions`);
    await h.container.billingService['apply'](
      { kind: 'charged', eventId: 'renew-1', providerSubId: sub.rows[0].providerSubId, providerPaymentId: 'pay_renew', amountPaise: 4900, periodEnd: null },
      {},
    );
    expect((await numbers(visitor)).items.find((p) => p.id === paused.id)?.status).toBe('active');
  });

  it('grace over → paid numbers are deleted and the subscription is cancelled', async () => {
    const user = await h.signUp();
    await createNumber(user, 'A');
    await createNumber(user, 'B');
    const paidId = await buyThird(user);
    await user.request({ method: 'POST', url: '/v1/billing/dev/fail' });
    await h.db.query(`UPDATE subscriptions SET "graceUntil" = now() - interval '1 minute'`);
    expect(await h.container.billingService.expireGrace()).toBe(1);
    expect((await numbers(user)).items.map((p) => p.id)).not.toContain(paidId);
    expect((await h.db.query(`SELECT status FROM subscriptions`)).rows[0].status).toBe('cancelled');
  });

  it('deleting a free number while paid ones exist makes a paid one free and lowers the quantity', async () => {
    const user = await h.signUp();
    const a = await createNumber(user, 'A');
    await createNumber(user, 'B');
    await buyThird(user);
    await user.request({ method: 'DELETE', url: `/v1/personas/${a.id}`, payload: { confirm: 'DELETE' } });
    await new Promise((r) => setTimeout(r, 50)); // reconcile runs on the retire event
    expect((await numbers(user)).plan).toMatchObject({ used: 2, paid: 0, free: 2 });
    expect((await billing(user)).subscription).toBeNull(); // quantity 0 → cancelled
  });

  it('billing reminders fire on day 0 once', async () => {
    const user = await h.signUp();
    await createNumber(user, 'A');
    await createNumber(user, 'B');
    await buyThird(user);
    await user.request({ method: 'POST', url: '/v1/billing/dev/fail' });
    expect((await h.container.billingService.dueReminders()).map((r) => r.day)).toEqual([0]);
    expect(await h.container.billingService.dueReminders()).toEqual([]);
  });
});

describe('Razorpay webhooks', () => {
  const secret = 'whsec_integration';
  let rz: Harness;
  beforeAll(async () => {
    rz = await createHarness({
      BILLING_PROVIDER: 'razorpay',
      RAZORPAY_KEY_ID: 'rzp_test_x',
      RAZORPAY_KEY_SECRET: 'secret',
      RAZORPAY_WEBHOOK_SECRET: secret,
      RAZORPAY_PLAN_ID: 'plan_x',
    });
  });
  afterAll(async () => rz.close());

  it('rejects bad signatures and processes each event once', async () => {
    await rz.reset();
    const user = await rz.signUp();
    const accountId = (await rz.db.query(`SELECT id FROM accounts`)).rows[0].id;
    await rz.db.query(`INSERT INTO subscriptions (id, "accountId", provider, "providerSubId", quantity, status, "updatedAt") VALUES (gen_random_uuid(), $1, 'razorpay', 'sub_T1', 1, 'created', now())`, [accountId]);

    const body = JSON.stringify({
      event: 'subscription.charged',
      payload: { subscription: { entity: { id: 'sub_T1', current_end: 1790000000 } }, payment: { entity: { id: 'pay_T1', amount: 4900 } } },
    });
    const bad = await rz.app.inject({ method: 'POST', url: '/v1/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': 'nope' } });
    expect(bad.statusCode).toBe(403);

    const sig = createHmac('sha256', secret).update(body).digest('hex');
    for (let i = 0; i < 2; i++) {
      const ok = await rz.app.inject({ method: 'POST', url: '/v1/billing/webhook', payload: body, headers: { 'content-type': 'application/json', 'x-razorpay-signature': sig } });
      expect(ok.statusCode).toBe(200);
    }
    expect((await rz.db.query(`SELECT count(*)::int AS n FROM payments`)).rows[0].n).toBe(1);
    expect((await rz.db.query(`SELECT status FROM subscriptions`)).rows[0].status).toBe('active');
    expect((await user.request<{ invoices: unknown[] }>({ method: 'GET', url: '/v1/billing' })).body.invoices).toHaveLength(1);
  });
});
