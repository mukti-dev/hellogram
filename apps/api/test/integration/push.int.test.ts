import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const voip = 'a1b2c3d4'.repeat(8);
const fcm = `fcm-${'Zx9_'.repeat(30)}:APA91b`;

const tokens = async () =>
  (await h.db.query<{ platform: string; kind: string; token: string }>('SELECT platform, kind, token FROM native_push_tokens ORDER BY kind')).rows;

describe('mobile app push tokens', () => {
  it('stores a phone token against this session and drops it when the session ends', async () => {
    const user = await h.signUp();
    const add = await user.request({ method: 'POST', url: '/v1/push/native', payload: { platform: 'ios', kind: 'voip', token: voip } });
    expect(add.status).toBe(204);
    expect(await tokens()).toEqual([{ platform: 'ios', kind: 'voip', token: voip }]);

    // Registering again (the app does on every launch) doesn't duplicate it.
    await user.request({ method: 'POST', url: '/v1/push/native', payload: { platform: 'ios', kind: 'voip', token: voip } });
    expect(await tokens()).toHaveLength(1);

    const logout = await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: `hg_rt=${user.refresh}`, 'x-hellogram-client': 'web' },
    });
    expect(logout.statusCode).toBeLessThan(300);
    const live = await h.db.query(
      'SELECT t.token FROM native_push_tokens t JOIN sessions s ON s.id = t."sessionId" WHERE s."revokedAt" IS NULL',
    );
    expect(live.rows).toEqual([]);
  });

  it('moves a token to whoever registers it last, and lets its owner remove it', async () => {
    const first = await h.signUp();
    const second = await h.signUp();
    await first.request({ method: 'POST', url: '/v1/push/native', payload: { platform: 'android', kind: 'alert', token: fcm } });
    await second.request({ method: 'POST', url: '/v1/push/native', payload: { platform: 'android', kind: 'alert', token: fcm } });
    const owner = await h.db.query<{ n: string }>('SELECT count(*)::text AS n FROM native_push_tokens');
    expect(owner.rows[0]?.n).toBe('1');

    // The previous owner can't remove someone else's token.
    await first.request({ method: 'DELETE', url: '/v1/push/native', payload: { token: fcm } });
    expect(await tokens()).toHaveLength(1);
    const removed = await second.request({ method: 'DELETE', url: '/v1/push/native', payload: { token: fcm } });
    expect(removed.status).toBe(204);
    expect(await tokens()).toEqual([]);
  });

  it('rejects junk tokens, Android "voip" tokens and signed-out callers', async () => {
    const user = await h.signUp();
    const bad = await user.request({ method: 'POST', url: '/v1/push/native', payload: { platform: 'ios', kind: 'voip', token: 'not a token!' } });
    expect(bad.status).toBe(400);
    const androidVoip = await user.request({ method: 'POST', url: '/v1/push/native', payload: { platform: 'android', kind: 'voip', token: fcm } });
    expect(androidVoip.status).toBe(400);
    const anonymous = await h.app.inject({ method: 'POST', url: '/v1/push/native', payload: { platform: 'ios', kind: 'alert', token: voip } });
    expect(anonymous.statusCode).toBe(401);
  });
});
