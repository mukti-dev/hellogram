import type { IncomingRequestDto, OwnPersonaDto, PublicCardDto, SentRequestDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertNoAccountLeak, createHarness, type Harness, type User } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

async function number(user: User, name: string, extra: Record<string, unknown> = {}) {
  const res = await user.request<OwnPersonaDto>({
    method: 'POST',
    url: '/v1/personas',
    payload: { displayName: name, labelName: 'OLX', labelIcon: 'shopping-bag', allowCalls: true, ...extra },
  });
  if (res.status !== 201) throw new Error(JSON.stringify(res.body));
  return res.body;
}

const send = (user: User, fromPersonaId: string, toCode: string, introMessage = 'Is this still available?') =>
  user.request<SentRequestDto & { error?: { code: string } }>({
    method: 'POST',
    url: '/v1/requests',
    payload: { fromPersonaId, toCode, introMessage },
  });

const incoming = async (user: User, status: 'pending' | 'blocked' = 'pending') =>
  (await user.request<{ items: IncomingRequestDto[] }>({ method: 'GET', url: `/v1/requests?status=${status}` })).body.items;

describe('public number card', () => {
  it('shows only name, avatar, code; lower-case codes work; retired looks like never-existed', async () => {
    const owner = await h.signUp();
    const p = await number(owner, 'Rahul Deals');
    const res = await h.app.inject({ method: 'GET', url: `/v1/public/numbers/${p.code.toLowerCase()}` });
    expect(res.json<PublicCardDto>()).toEqual({ code: p.code, displayName: 'Rahul Deals', avatarUrl: null, acceptsRequests: true });
    assertNoAccountLeak(res.json());

    await owner.request({ method: 'DELETE', url: `/v1/personas/${p.id}`, payload: { confirm: 'DELETE' } });
    const retired = await h.app.inject({ method: 'GET', url: `/v1/public/numbers/${p.code}` });
    const missing = await h.app.inject({ method: 'GET', url: '/v1/public/numbers/Z999999Z' });
    expect(retired.statusCode).toBe(404);
    expect(retired.body).toBe(missing.body);
  });
});

describe('contact requests (rules 10–13)', () => {
  it('request → owner sees only the sender’s name/avatar/code → accept creates the chat with the intro', async () => {
    const owner = await h.signUp();
    const visitor = await h.signUp();
    const rahul = await number(owner, 'Rahul Deals');
    const amit = await number(visitor, 'Amit Kumar');

    const sent = await send(visitor, amit.id, rahul.code);
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('pending');

    const [req] = await incoming(owner);
    expect(req).toMatchObject({
      from: { id: amit.id, code: amit.code, displayName: 'Amit Kumar', avatarUrl: null },
      to: { id: rahul.id, labelName: 'OLX', labelIcon: 'shopping-bag' },
      introMessage: 'Is this still available?',
    });
    expect(Object.keys(req!.from).sort()).toEqual(['avatarUrl', 'code', 'displayName', 'id']);
    assertNoAccountLeak(req);

    const accepted = await owner.request<{ conversationId: string }>({ method: 'POST', url: `/v1/requests/${req!.id}/accept` });
    expect(accepted.status).toBe(200);
    const msgs = await h.db.query('SELECT body, "senderPersonaId" FROM messages WHERE "conversationId" = $1', [
      accepted.body.conversationId,
    ]);
    expect(msgs.rows).toEqual([{ body: 'Is this still available?', senderPersonaId: amit.id }]);
    expect(await incoming(owner)).toEqual([]);
  });

  it('an empty intro gets the default text', async () => {
    const owner = await h.signUp();
    const visitor = await h.signUp();
    const target = await number(owner, 'T');
    const from = await number(visitor, 'F');
    await send(visitor, from.id, target.code, '');
    expect((await incoming(owner))[0]?.introMessage).toBe('Hi, I’d like to connect.');
  });

  it('you cannot request your own number', async () => {
    const user = await h.signUp();
    const a = await number(user, 'A');
    const b = await number(user, 'B');
    expect((await send(user, a.id, b.code)).body.error?.code).toBe('OWN_NUMBER');
  });

  it('one pending request per pair; paused numbers and acceptRequests=false refuse requests', async () => {
    const owner = await h.signUp();
    const visitor = await h.signUp();
    const target = await number(owner, 'T');
    const from = await number(visitor, 'F');
    await send(visitor, from.id, target.code);
    expect((await send(visitor, from.id, target.code)).body.error?.code).toBe('REQUEST_ALREADY_PENDING');

    const closed = await number(owner, 'Closed');
    await owner.request({ method: 'PATCH', url: `/v1/personas/${closed.id}`, payload: { acceptRequests: false } });
    expect((await send(visitor, from.id, closed.code)).body.error?.code).toBe('NOT_ACCEPTING_REQUESTS');
  });

  it('declined senders wait 7 days — from any of their numbers (rule 12)', async () => {
    const owner = await h.signUp();
    const visitor = await h.signUp();
    const target = await number(owner, 'T');
    const from1 = await number(visitor, 'F1');
    const from2 = await number(visitor, 'F2');
    await send(visitor, from1.id, target.code);
    const [req] = await incoming(owner);
    await owner.request({ method: 'POST', url: `/v1/requests/${req!.id}/decline` });

    expect((await send(visitor, from1.id, target.code)).body.error?.code).toBe('REQUEST_COOLDOWN');
    expect((await send(visitor, from2.id, target.code)).body.error?.code).toBe('REQUEST_COOLDOWN');

    await h.db.query(`UPDATE contact_requests SET "respondedAt" = now() - interval '8 days'`);
    expect((await send(visitor, from2.id, target.code)).status).toBe(201);
  });
});

describe('silent account-level block from a request (rules 14–16)', () => {
  it('blocks every number of the sender, silently; unblock restores delivery', async () => {
    const owner = await h.signUp();
    const creep = await h.signUp();
    const rahul = await number(owner, 'Rahul');
    const coffee = await number(owner, 'Coffee');
    const creep1 = await number(creep, 'Creep One');
    const creep2 = await number(creep, 'Creep Two');

    await send(creep, creep1.id, rahul.code);
    const [req] = await incoming(owner);
    expect((await owner.request({ method: 'POST', url: `/v1/requests/${req!.id}/block` })).status).toBe(204);

    // Blocked tab shows it; pending doesn't.
    expect(await incoming(owner)).toEqual([]);
    expect((await incoming(owner, 'blocked')).map((r) => r.from.code)).toEqual([creep1.code]);

    // The creep's view: still "pending", and a new request from another number to another
    // of the owner's numbers looks exactly like a normal success.
    const sentList = await creep.request<{ items: SentRequestDto[] }>({ method: 'GET', url: '/v1/requests/sent' });
    expect(sentList.body.items.map((r) => r.status)).toEqual(['pending']);
    const sneaky = await send(creep, creep2.id, coffee.code);
    expect(sneaky.status).toBe(201);
    expect(sneaky.body.status).toBe('pending');
    expect(await incoming(owner)).toEqual([]); // never delivered

    // Settings → Blocked lists it by code; unblocking lets new requests through.
    const blocks = await owner.request<{ items: { id: string; blockedCode: string; fromCode: string }[] }>({
      method: 'GET',
      url: '/v1/blocks',
    });
    expect(blocks.body.items).toEqual([expect.objectContaining({ blockedCode: creep1.code, fromCode: rahul.code })]);
    assertNoAccountLeak(blocks.body);
    await owner.request({ method: 'DELETE', url: `/v1/blocks/${blocks.body.items[0]!.id}` });

    // The suppressed request expires like any other; a fresh one is now delivered.
    await h.db.query(`UPDATE contact_requests SET status = 'expired' WHERE suppressed = true`);
    expect((await send(creep, creep2.id, coffee.code)).status).toBe(201);
    expect((await incoming(owner)).map((r) => r.to.id)).toEqual([coffee.id]);
  });
});
