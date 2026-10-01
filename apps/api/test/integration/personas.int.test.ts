import { NUMBER_CODE_PATTERN, type OwnPersonaDto, type PersonaListDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { assertNoAccountLeak, createHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const create = (user: Awaited<ReturnType<Harness['signUp']>>, name = 'Rahul Deals', labelKind = 'olx') =>
  user.request<OwnPersonaDto>({ method: 'POST', url: '/v1/personas', payload: { displayName: name, labelKind, allowCalls: true } });

describe('numbers (rules 5–8)', () => {
  it('creates numbers with unique, well-formed codes and never leaks account ids', async () => {
    const user = await h.signUp();
    const res = await create(user);
    expect(res.status).toBe(201);
    expect(res.body.code).toMatch(NUMBER_CODE_PATTERN);
    expect(res.body).toMatchObject({ displayName: 'Rahul Deals', labelKind: 'olx', status: 'active', isPaid: false });
    assertNoAccountLeak(res.body);

    const list = await user.request<PersonaListDto>({ method: 'GET', url: '/v1/personas' });
    expect(list.body.plan).toEqual({ used: 1, max: 5, free: 1, paid: 0, freeLeft: 1 });
  });

  it('first two are free; the third needs payment (402 with a checkout)', async () => {
    const user = await h.signUp();
    expect((await create(user, 'One')).status).toBe(201);
    expect((await create(user, 'Two')).status).toBe(201);
    const third = await create(user, 'Three');
    expect(third.status).toBe(402);
    expect(third.body).toMatchObject({ checkout: { provider: 'dev', payload: { amountPaise: 4900 } } });
    // Nothing is created until payment is confirmed.
    expect((await user.request<PersonaListDto>({ method: 'GET', url: '/v1/personas' })).body.items).toHaveLength(2);
  });

  it('limits new numbers to 3 per 7 days even when deleting (churn, rule 8)', async () => {
    const user = await h.signUp();
    for (const name of ['A', 'B', 'C']) {
      const p = await create(user, name);
      if (name !== 'C') {
        expect(p.status).toBe(201);
        await user.request({ method: 'DELETE', url: `/v1/personas/${p.body.id}`, payload: { confirm: 'DELETE' } });
      } else {
        expect(p.status).toBe(201);
      }
    }
    const fourth = await create(user, 'D');
    expect((fourth.body as unknown as { error: { code: string } }).error.code).toBe('PERSONA_CHURN_LIMIT');
  });

  it('retire requires typed confirmation, is permanent, and codes are never reused', async () => {
    const user = await h.signUp();
    const p = await create(user);
    const wrong = await user.request({ method: 'DELETE', url: `/v1/personas/${p.body.id}`, payload: { confirm: 'delete' } });
    expect(wrong.status).toBe(400);

    const ok = await user.request({ method: 'DELETE', url: `/v1/personas/${p.body.id}`, payload: { confirm: 'DELETE' } });
    expect(ok.status).toBe(204);
    const retired = await h.db.query('SELECT code FROM retired_codes');
    expect(retired.rows).toEqual([{ code: p.body.code }]);
    expect((await user.request({ method: 'GET', url: `/v1/personas/${p.body.id}` })).status).toBe(404);
    expect(await h.container.personaService['deps'].personas.codeTaken(p.body.code)).toBe(true);
  });

  it('pause and resume (rule 7)', async () => {
    const user = await h.signUp();
    const p = await create(user);
    const paused = await user.request<OwnPersonaDto>({ method: 'POST', url: `/v1/personas/${p.body.id}/pause` });
    expect(paused.body).toMatchObject({ status: 'paused', pauseReason: 'user' });
    const resumed = await user.request<OwnPersonaDto>({ method: 'POST', url: `/v1/personas/${p.body.id}/resume` });
    expect(resumed.body).toMatchObject({ status: 'active', pauseReason: null });
  });

  it('updates settings and validates labels', async () => {
    const user = await h.signUp();
    const p = await create(user);
    const res = await user.request<OwnPersonaDto>({
      method: 'PATCH',
      url: `/v1/personas/${p.body.id}`,
      payload: { displayName: 'Coffee Chats', labelKind: 'other', labelText: 'Freelance', readReceipts: false, defaultRetention: 'd7' },
    });
    expect(res.body).toMatchObject({ displayName: 'Coffee Chats', labelKind: 'other', labelText: 'Freelance', readReceipts: false, defaultRetention: 'd7' });
    const tooLong = await user.request({ method: 'PATCH', url: `/v1/personas/${p.body.id}`, payload: { labelKind: 'other', labelText: 'x'.repeat(17) } });
    expect(tooLong.status).toBe(400);
  });

  it('share returns the public link and a QR SVG', async () => {
    const user = await h.signUp();
    const p = await create(user);
    const res = await user.request<{ url: string; qrSvg: string }>({ method: 'GET', url: `/v1/personas/${p.body.id}/share` });
    expect(res.body.url).toBe(`http://localhost:5173/${p.body.code}`);
    expect(res.body.qrSvg).toContain('<svg');
  });

  it("another account can't see or change my numbers", async () => {
    const owner = await h.signUp();
    const other = await h.signUp();
    const p = await create(owner);
    expect((await other.request({ method: 'GET', url: `/v1/personas/${p.body.id}` })).status).toBe(404);
    expect((await other.request({ method: 'POST', url: `/v1/personas/${p.body.id}/pause` })).status).toBe(404);
    expect((await other.request<PersonaListDto>({ method: 'GET', url: '/v1/personas' })).body.items).toEqual([]);
  });

  it('accepts real images only for avatars, stored under a random key', async () => {
    const user = await h.signUp();
    const p = await create(user);
    const png = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex');
    const ok = await user.request<OwnPersonaDto>({
      method: 'PUT',
      url: `/v1/personas/${p.body.id}/avatar`,
      payload: png,
      headers: { 'content-type': 'image/png' },
    });
    expect(ok.status).toBe(200);
    expect(ok.body.avatarUrl).toMatch(/^\/media\/avatars\/[\w-]+\.png$/);

    const fake = await user.request({
      method: 'PUT',
      url: `/v1/personas/${p.body.id}/avatar`,
      payload: Buffer.from('<script>alert(1)</script>'),
      headers: { 'content-type': 'image/png' },
    });
    expect(fake.status).toBe(400);
  });
});
