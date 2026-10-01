import type { InboxDto, MessagePageDto, PersonaListDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair, sendMessage } from './fixtures.js';
import { createHarness, type Harness } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ OTP_BYPASS: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

// With OTP_BYPASS off here, the harness reads sign-up codes from the dev SMS log.

async function lockedPair() {
  const pair = await connectedPair(h);
  const set = await pair.owner.request<{ unlockToken: string }>({
    method: 'PUT',
    url: `/v1/personas/${pair.ownerNumber.id}/pin`,
    payload: { pin: '4826' },
  });
  expect(set.status).toBe(200);
  return pair;
}

describe('number lock (rules 24–25)', () => {
  it('hides chats and requests of a locked number unless this device unlocked it', async () => {
    const { owner, ownerNumber, conversationId } = await lockedPair();

    const personas = await owner.request<PersonaListDto>({ method: 'GET', url: '/v1/personas' });
    expect(personas.body.items[0]).toMatchObject({ hasPin: true, locked: true });

    const inbox = await owner.request<InboxDto>({ method: 'GET', url: '/v1/conversations' });
    expect(inbox.body.items).toEqual([]);
    expect(inbox.body.locked).toEqual([expect.objectContaining({ personaId: ownerNumber.id, displayName: 'Rahul Deals' })]);
    expect(JSON.stringify(inbox.body)).not.toContain('Amit Kumar');

    const blocked = await owner.request<{ error: { code: string } }>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` });
    expect(blocked.body.error.code).toBe('PERSONA_LOCKED');

    const unlock = await owner.request<{ unlockToken: string }>({
      method: 'POST',
      url: `/v1/personas/${ownerNumber.id}/unlock`,
      payload: { pin: '4826' },
    });
    const headers = { 'x-persona-unlock': unlock.body.unlockToken };
    const msgs = await owner.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages`, headers });
    expect(msgs.status).toBe(200);
    expect((await owner.request<InboxDto>({ method: 'GET', url: '/v1/conversations', headers })).body.items).toHaveLength(1);
    expect((await owner.request<PersonaListDto>({ method: 'GET', url: '/v1/personas', headers })).body.items[0]?.locked).toBe(false);
  });

  it('unlock tokens are tied to the device (session) that unlocked', async () => {
    const { owner, ownerNumber, conversationId } = await lockedPair();
    const unlock = await owner.request<{ unlockToken: string }>({
      method: 'POST',
      url: `/v1/personas/${ownerNumber.id}/unlock`,
      payload: { pin: '4826' },
    });
    // Same account, second device (new session via refresh-less login isn't possible here, so forge a session by logging in again).
    const phoneRow = await h.db.query(`SELECT phone FROM accounts a JOIN personas p ON p."accountId" = a.id WHERE p.id = $1`, [ownerNumber.id]);
    const second = await h.signUp(phoneRow.rows[0].phone.slice(3)); // existing number: logs in from a new device
    const res = await h.app.inject({
      method: 'GET',
      url: `/v1/conversations/${conversationId}/messages`,
      headers: { ...second.headers, 'x-persona-unlock': unlock.body.unlockToken },
    });
    expect(res.json().error.code).toBe('PERSONA_LOCKED');
  });

  it('changing the PIN needs the current one', async () => {
    const { owner, ownerNumber } = await lockedPair();
    const res = await owner.request<{ error: { code: string } }>({ method: 'PUT', url: `/v1/personas/${ownerNumber.id}/pin`, payload: { pin: '1111' } });
    expect(res.body.error.code).toBe('PIN_INVALID');
    const ok = await owner.request({ method: 'PUT', url: `/v1/personas/${ownerNumber.id}/pin`, payload: { pin: '1111', currentPin: '4826' } });
    expect(ok.status).toBe(200);
  });
});

describe('lockouts (rule 26)', () => {
  it('5 wrong PINs lock the number for 15 minutes, even for the right PIN', async () => {
    const { owner, ownerNumber } = await lockedPair();
    const attempt = (pin: string) =>
      owner.request<{ error?: { code: string; details?: { attemptsLeft?: number } } }>({
        method: 'POST',
        url: `/v1/personas/${ownerNumber.id}/unlock`,
        payload: { pin },
      });
    for (let i = 0; i < 4; i++) expect((await attempt('0000')).body.error?.code).toBe('PIN_INVALID');
    expect((await attempt('0000')).body.error?.code).toBe('PIN_LOCKED_OUT');
    expect((await attempt('4826')).body.error?.code).toBe('PIN_LOCKED_OUT');

    await h.db.query(`UPDATE personas SET "pinLockedUntil" = now() - interval '1 second'`);
    expect((await attempt('4826')).status).toBe(200);
  });
});

describe('forgot PIN (rule 28)', () => {
  it('OTP → clears only this number’s side of every chat → new PIN; the other side keeps everything', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await lockedPair();
    await sendMessage(visitor, conversationId, 'before reset');

    await owner.request({ method: 'POST', url: `/v1/personas/${ownerNumber.id}/pin/reset/otp` });
    const code = h.devOtps.at(-1)!;
    const wrong = await owner.request<{ error: { code: string } }>({
      method: 'POST',
      url: `/v1/personas/${ownerNumber.id}/pin/reset`,
      payload: { code: '000000', newPin: '9999' },
    });
    expect(wrong.body.error.code).toMatch(/OTP_INVALID|OTP_EXPIRED/);

    const reset = await owner.request<{ unlockToken: string }>({
      method: 'POST',
      url: `/v1/personas/${ownerNumber.id}/pin/reset`,
      payload: { code, newPin: '9999' },
    });
    expect(reset.status).toBe(200);
    const headers = { 'x-persona-unlock': reset.body.unlockToken };
    const mine = await owner.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages`, headers });
    expect(mine.body.items).toEqual([]);
    const theirs = await visitor.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` });
    expect(theirs.body.items.map((m) => m.body)).toContain('before reset');

    // The conversation and contact survive.
    expect((await owner.request<InboxDto>({ method: 'GET', url: '/v1/conversations', headers })).body.items).toHaveLength(1);
    const unlockWithNew = await owner.request({ method: 'POST', url: `/v1/personas/${ownerNumber.id}/unlock`, payload: { pin: '9999' } });
    expect(unlockWithNew.status).toBe(200);
  });
});
