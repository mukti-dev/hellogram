import type { IncomingRequestDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair, createNumber } from './fixtures.js';
import { createHarness, type Harness } from './harness.js';

/** Regression tests for the security review (Phase 11). */
let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

describe('parallel brute force', () => {
  it('10 simultaneous wrong PINs still trip the lockout, and then the right PIN is refused', async () => {
    const { owner, ownerNumber } = await connectedPair(h);
    await owner.request({ method: 'PUT', url: `/v1/personas/${ownerNumber.id}/pin`, payload: { pin: '4826' } });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        owner.request({ method: 'POST', url: `/v1/personas/${ownerNumber.id}/unlock`, payload: { pin: '0000' } }),
      ),
    );
    const row = await h.db.query(`SELECT "pinLockedUntil" FROM personas WHERE id = $1`, [ownerNumber.id]);
    expect(row.rows[0].pinLockedUntil).not.toBeNull();
    const right = await owner.request<{ error: { code: string } }>({ method: 'POST', url: `/v1/personas/${ownerNumber.id}/unlock`, payload: { pin: '4826' } });
    expect(right.body.error.code).toBe('PIN_LOCKED_OUT');
  });
});

describe('block and ownership oracles', () => {
  it('re-requesting after being blocked gets the same 409 as an ordinary pending request', async () => {
    const owner = await h.signUp();
    const creep = await h.signUp();
    const target = await createNumber(owner, 'T');
    const from = await createNumber(creep, 'C');
    await creep.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: from.id, toCode: target.code } });
    const [req] = (await owner.request<{ items: IncomingRequestDto[] }>({ method: 'GET', url: '/v1/requests' })).body.items;
    await owner.request({ method: 'POST', url: `/v1/requests/${req!.id}/block` });
    const again = await creep.request<{ error: { code: string } }>({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: from.id, toCode: target.code } });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('REQUEST_ALREADY_PENDING');

    // The creep's data export doesn't reveal it either.
    const exported = await creep.request<{ requestsSent: { status: string }[] }>({ method: 'GET', url: '/v1/me/export' });
    expect(exported.body.requestsSent.map((r) => r.status)).toEqual(['pending']);
  });

  it('requesting a deleted number looks exactly like requesting one that never existed', async () => {
    const owner = await h.signUp();
    const visitor = await h.signUp();
    const gone = await createNumber(owner, 'Gone');
    const from = await createNumber(visitor, 'V');
    await owner.request({ method: 'DELETE', url: `/v1/personas/${gone.id}`, payload: { confirm: 'DELETE' } });
    const a = await visitor.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: from.id, toCode: gone.code } });
    const b = await visitor.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: from.id, toCode: 'Z999999Z' } });
    expect([a.status, b.status]).toEqual([404, 404]);
    expect(a.body).toEqual(b.body);
  });

  it('phone change never reveals whether a number is registered', async () => {
    await h.signUp('9866666666');
    const user = await h.signUp('9877777777');
    const taken = await user.request({ method: 'POST', url: '/v1/me/phone-change', payload: { newPhone: '9866666666' } });
    const free = await user.request({ method: 'POST', url: '/v1/me/phone-change', payload: { newPhone: '9888888888' } });
    expect([taken.status, free.status]).toEqual([204, 204]);
  });
});

describe('PIN lock covers management actions', () => {
  it('a locked number can’t be shared, changed or deleted without unlocking', async () => {
    const { owner, ownerNumber } = await connectedPair(h);
    await owner.request({ method: 'PUT', url: `/v1/personas/${ownerNumber.id}/pin`, payload: { pin: '4826' } });
    const share = await owner.request<{ error: { code: string } }>({ method: 'GET', url: `/v1/personas/${ownerNumber.id}/share` });
    expect(share.body.error.code).toBe('PERSONA_LOCKED');
    const del = await owner.request<{ error: { code: string } }>({ method: 'DELETE', url: `/v1/personas/${ownerNumber.id}`, payload: { confirm: 'DELETE' } });
    expect(del.body.error.code).toBe('PERSONA_LOCKED');
    const sent = await owner.request<{ items: unknown[] }>({ method: 'GET', url: '/v1/requests/sent' });
    expect(sent.status).toBe(200);
  });
});

describe('abuse and SSRF', () => {
  it('push subscriptions only accept real browser push services', async () => {
    const user = await h.signUp();
    const bad = await user.request({
      method: 'POST',
      url: '/v1/push/subscribe',
      payload: { endpoint: 'http://169.254.169.254/latest/meta-data', keys: { p256dh: 'x', auth: 'y' } },
    });
    expect(bad.status).toBe(400);
    const good = await user.request({
      method: 'POST',
      url: '/v1/push/subscribe',
      payload: { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: 'x', auth: 'y' } },
    });
    expect(good.status).toBe(204);
  });

  it('forged X-Forwarded-For headers don’t reset per-IP limits', async () => {
    let limited = false;
    for (let i = 0; i < 12; i++) {
      const res = await h.app.inject({
        method: 'POST',
        url: '/v1/auth/otp/send',
        payload: { phone: `98${String(10000000 + i)}` },
        headers: { 'x-forwarded-for': `10.0.${i}.1` },
      });
      if (res.statusCode === 429) limited = true;
    }
    expect(limited).toBe(true);
  });
});
