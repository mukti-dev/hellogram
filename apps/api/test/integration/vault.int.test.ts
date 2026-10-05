import type { InboxDto, MessagePageDto, VaultSummaryDto, VaultTokenDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair, createNumber, sendMessage } from './fixtures.js';
import { createHarness, type Harness, type User } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness({ OTP_BYPASS: 'false' });
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

type Err = { error: { code: string } };

const inbox = (u: User, folder?: string, headers?: Record<string, string>) =>
  u.request<InboxDto>({ method: 'GET', url: `/v1/conversations${folder ? `?folder=${folder}` : ''}`, ...(headers ? { headers } : {}) });
const move = (u: User, id: string, payload: Record<string, unknown>, headers?: Record<string, string>) =>
  u.request<Err>({ method: 'POST', url: `/v1/conversations/${id}/vault`, payload, ...(headers ? { headers } : {}) });
const messages = (u: User, id: string, headers?: Record<string, string>) =>
  u.request<MessagePageDto & Err>({ method: 'GET', url: `/v1/conversations/${id}/messages`, ...(headers ? { headers } : {}) });

describe('chat vault', () => {
  it('archives a chat out of the inbox and the unread badge, and brings it back', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await sendMessage(visitor, conversationId, 'are you there?');

    expect((await move(owner, conversationId, { to: 'archived' })).status).toBe(204);
    expect((await inbox(owner)).body.items).toEqual([]);
    expect((await inbox(owner, 'archived')).body.items.map((c) => c.vault)).toEqual(['archived']);
    expect((await owner.request<VaultSummaryDto>({ method: 'GET', url: '/v1/vault' })).body).toEqual({ lockPinSet: false, archived: 1, locked: 0 });
    expect((await owner.request<{ count: number }>({ method: 'GET', url: '/v1/conversations/unread-count' })).body.count).toBe(0);
    // Still readable: archiving isn't a lock.
    expect((await messages(owner, conversationId)).status).toBe(200);

    await move(owner, conversationId, { to: 'inbox' });
    expect((await inbox(owner)).body.items).toHaveLength(1);
    // The other side never notices.
    expect((await inbox(visitor)).body.items[0]?.vault).toBeNull();
  });

  it('locks a chat with the chat lock PIN; this device opens it for a while', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await sendMessage(visitor, conversationId, 'secret plans');

    expect((await move(owner, conversationId, { to: 'locked', pin: '1357' })).body.error.code).toBe('VAULT_PIN_NOT_SET');
    expect((await owner.request({ method: 'PUT', url: '/v1/vault/lock-pin', payload: { pin: '1357' } })).status).toBe(204);
    expect((await move(owner, conversationId, { to: 'locked', pin: '0000' })).body.error.code).toBe('PIN_INVALID');
    expect((await move(owner, conversationId, { to: 'locked', pin: '1357' })).status).toBe(204);

    expect((await inbox(owner)).body.items).toEqual([]);
    const lockedRows = (await inbox(owner, 'locked')).body.items;
    expect(lockedRows).toHaveLength(1);
    expect(lockedRows[0]?.lastMessage).toBeNull();
    expect(JSON.stringify(lockedRows)).not.toContain('secret plans');
    expect((await messages(owner, conversationId)).body.error.code).toBe('CHAT_LOCKED');

    const wrong = await owner.request<Err>({ method: 'POST', url: `/v1/conversations/${conversationId}/unlock`, payload: { pin: '9999', duration: 600 } });
    expect(wrong.body.error.code).toBe('PIN_INVALID');
    const open = await owner.request<VaultTokenDto>({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/unlock`,
      payload: { pin: '1357', duration: 600 },
    });
    expect(open.status).toBe(200);
    const headers = { 'x-vault-unlock': open.body.token };
    expect((await messages(owner, conversationId, headers)).body.items.map((m) => m.body)).toContain('secret plans');
    expect((await inbox(owner, 'locked', headers)).body.items[0]?.lastMessage?.body).toBe('secret plans');
    expect((await sendMessage(owner, conversationId, 'not without the token')).body.error?.code).toBe('CHAT_LOCKED');
    const sent = await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/messages`, headers, payload: { clientMessageId: 'c-vault-0001', body: 'hi' } });
    expect(sent.status).toBe(201);

    // Changing the lock PIN needs the current one and closes every open chat.
    const change = await owner.request<Err>({ method: 'PUT', url: '/v1/vault/lock-pin', payload: { pin: '2468' } });
    expect(change.body.error.code).toBe('PIN_INVALID');
    await owner.request({ method: 'PUT', url: '/v1/vault/lock-pin', payload: { pin: '2468', currentPin: '1357' } });
    expect((await messages(owner, conversationId, headers)).body.error.code).toBe('CHAT_LOCKED');

    // Unlocking for good needs the PIN.
    expect((await move(owner, conversationId, { to: 'inbox' })).body.error.code).toBe('CHAT_LOCKED');
    expect((await move(owner, conversationId, { to: 'inbox', pin: '2468' })).status).toBe(204);
    expect((await messages(owner, conversationId)).status).toBe(200);
  });

  it('hides chats per hide PIN; each PIN shows only its own chats', async () => {
    const a = await connectedPair(h);
    const second = await h.signUp();
    const secondNumber = await createNumber(second, 'Neha');
    await second.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: secondNumber.id, toCode: a.ownerNumber.code, introMessage: 'Hello' } });
    const req = await a.owner.request<{ items: { id: string }[] }>({ method: 'GET', url: '/v1/requests' });
    const b = await a.owner.request<{ conversationId: string }>({ method: 'POST', url: `/v1/requests/${req.body.items[0]!.id}/accept` });
    const chatA = a.conversationId;
    const chatB = b.body.conversationId;

    // A new hide PIN must be confirmed.
    expect((await move(a.owner, chatA, { to: 'hidden', pin: '1111' })).body.error.code).toBe('VAULT_NEW_PIN');
    expect((await move(a.owner, chatA, { to: 'hidden', pin: '1111', newSpace: true })).status).toBe(204);
    expect((await move(a.owner, chatB, { to: 'hidden', pin: '2222', newSpace: true })).status).toBe(204);

    // Gone everywhere: inbox, vault counts, direct access.
    expect((await inbox(a.owner)).body.items).toEqual([]);
    expect((await inbox(a.owner, 'hidden')).body.items).toEqual([]);
    expect((await a.owner.request<VaultSummaryDto>({ method: 'GET', url: '/v1/vault' })).body).toMatchObject({ archived: 0, locked: 0 });
    expect((await messages(a.owner, chatA)).body.error.code).toBe('NOT_FOUND');

    const wrong = await a.owner.request<Err>({ method: 'POST', url: '/v1/vault/reveal', payload: { pin: '3333', duration: 0 } });
    expect(wrong.body.error.code).toBe('PIN_INVALID');
    const reveal = await a.owner.request<VaultTokenDto>({ method: 'POST', url: '/v1/vault/reveal', payload: { pin: '1111', duration: 0 } });
    const headers = { 'x-vault-unlock': reveal.body.token };
    const shown = (await inbox(a.owner, 'hidden', headers)).body.items;
    expect(shown.map((c) => c.id)).toEqual([chatA]);
    expect((await messages(a.owner, chatA, headers)).status).toBe(200);
    expect((await messages(a.owner, chatB, headers)).body.error.code).toBe('NOT_FOUND');

    // Unhide needs the space open.
    expect((await move(a.owner, chatB, { to: 'inbox' }, headers)).body.error.code).toBe('NOT_FOUND');
    expect((await move(a.owner, chatA, { to: 'inbox' }, headers)).status).toBe(204);
    expect((await inbox(a.owner)).body.items.map((c) => c.id)).toEqual([chatA]);
  });

  it('forgot hide PIN: a code to the phone brings every hidden chat back', async () => {
    const { owner, conversationId } = await connectedPair(h);
    await move(owner, conversationId, { to: 'hidden', pin: '1111', newSpace: true });

    await owner.request({ method: 'POST', url: '/v1/vault/reset/otp' });
    const code = h.devOtps.at(-1)!;
    expect((await owner.request({ method: 'POST', url: '/v1/vault/reset', payload: { target: 'hidden', code } })).status).toBe(204);
    expect((await inbox(owner)).body.items.map((c) => c.id)).toEqual([conversationId]);
    const old = await owner.request<Err>({ method: 'POST', url: '/v1/vault/reveal', payload: { pin: '1111', duration: 0 } });
    expect(old.body.error.code).toBe('PIN_INVALID');
  });

  it('forgot lock PIN: a code to the phone sets a new one; chats stay locked', async () => {
    const { owner, conversationId } = await connectedPair(h);
    await owner.request({ method: 'PUT', url: '/v1/vault/lock-pin', payload: { pin: '1357' } });
    await move(owner, conversationId, { to: 'locked', pin: '1357' });

    await owner.request({ method: 'POST', url: '/v1/vault/reset/otp' });
    const code = h.devOtps.at(-1)!;
    expect((await owner.request({ method: 'POST', url: '/v1/vault/reset', payload: { target: 'lock', code, newPin: '8642' } })).status).toBe(204);
    expect((await inbox(owner, 'locked')).body.items).toHaveLength(1);
    const open = await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/unlock`, payload: { pin: '8642', duration: 0 } });
    expect(open.status).toBe(200);
  });
});
