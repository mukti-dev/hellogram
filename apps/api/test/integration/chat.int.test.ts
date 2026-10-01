import type { ConversationDto, InboxDto, MessagePageDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientId, connectedPair, sendMessage } from './fixtures.js';
import { assertNoAccountLeak, createHarness, type Harness, type User } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const inbox = async (u: User, qs = '') => (await u.request<InboxDto>({ method: 'GET', url: `/v1/conversations${qs}` })).body;
const messages = async (u: User, id: string) =>
  (await u.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${id}/messages` })).body.items;

describe('inbox', () => {
  it('shows the accepted chat with the intro as last message, unread for the owner only', async () => {
    const { owner, visitor, visitorNumber, ownerNumber } = await connectedPair(h);
    const [row] = (await inbox(owner)).items;
    expect(row).toMatchObject({
      me: { id: ownerNumber.id, labelKind: 'olx' },
      counterpart: { id: visitorNumber.id, code: visitorNumber.code, displayName: 'Amit Kumar', masked: false },
      unread: 1,
      unavailable: false,
      retention: 'd30',
      lastMessage: { body: 'Hi, is this still available?', mine: false },
    });
    assertNoAccountLeak(row);
    expect((await inbox(visitor)).items[0]).toMatchObject({ unread: 0, lastMessage: { mine: true, status: 'sent' } });
  });

  it('filters by label, unread and search (nickname or name)', async () => {
    const { owner, conversationId } = await connectedPair(h);
    expect((await inbox(owner, '?label=dating')).items).toHaveLength(0);
    expect((await inbox(owner, '?label=olx')).items).toHaveLength(1);
    expect((await inbox(owner, '?unread=true')).items).toHaveLength(1);
    await owner.request({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { nickname: 'Laptop buyer' } });
    expect((await inbox(owner, '?q=laptop')).items).toHaveLength(1);
    expect((await inbox(owner, '?q=amit')).items).toHaveLength(1);
    expect((await inbox(owner, '?q=zzz')).items).toHaveLength(0);
  });

  it('nicknames are private to the user who set them', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await owner.request({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { nickname: '  Laptop buyer 💻 ' } });
    expect((await inbox(owner)).items[0]?.nickname).toBe('Laptop buyer 💻');
    const theirs = (await inbox(visitor)).items[0]!;
    expect(theirs.nickname).toBeNull();
    expect(JSON.stringify(theirs)).not.toContain('Laptop buyer');
  });

  it('outsiders cannot open a conversation', async () => {
    const { conversationId } = await connectedPair(h);
    const stranger = await h.signUp();
    expect((await stranger.request({ method: 'GET', url: `/v1/conversations/${conversationId}` })).status).toBe(404);
    expect((await stranger.request({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` })).status).toBe(404);
  });
});

describe('messages, ticks and receipts (rules 17–19)', () => {
  it('retries with the same clientMessageId never duplicate', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const cid = clientId();
    const a = await sendMessage(visitor, conversationId, 'Hello', cid);
    const b = await sendMessage(visitor, conversationId, 'Hello', cid);
    expect(a.body.id).toBe(b.body.id);
    expect((await messages(visitor, conversationId)).filter((m) => m.body === 'Hello')).toHaveLength(1);
  });

  it('limits sending to 30 messages a minute per number', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    for (let i = 0; i < 30; i++) expect((await sendMessage(visitor, conversationId, `m${i}`)).status).toBe(201);
    expect((await sendMessage(visitor, conversationId, 'one too many')).body.error?.code).toBe('RATE_LIMITED');
  });

  it('rejects messages over 4,000 characters', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    expect((await sendMessage(visitor, conversationId, 'x'.repeat(4001))).body.error?.code).toBe('MESSAGE_TOO_LONG');
  });

  it('sent → delivered (device ack) → read', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const sent = await sendMessage(visitor, conversationId, 'Can you share photos?');
    expect(sent.body.status).toBe('sent');

    await owner.request({ method: 'POST', url: '/v1/messages/ack', payload: { messageIds: [sent.body.id] } });
    expect((await messages(visitor, conversationId))[0]?.status).toBe('delivered');

    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/read`, payload: { upToMessageId: sent.body.id } });
    expect((await messages(visitor, conversationId))[0]?.status).toBe('read');
    expect((await inbox(owner)).items[0]?.unread).toBe(0);
  });

  it('read ticks are only sent if the reader has read receipts on', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);
    await owner.request({ method: 'PATCH', url: `/v1/personas/${ownerNumber.id}`, payload: { readReceipts: false } });
    const sent = await sendMessage(visitor, conversationId, 'Hello?');
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/read`, payload: { upToMessageId: sent.body.id } });
    expect((await messages(visitor, conversationId))[0]?.status).toBe('delivered');
    expect((await inbox(owner)).items[0]?.unread).toBe(0);
  });

  it('delete for me hides only on my side; delete for everyone within 60 minutes', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const m1 = await sendMessage(visitor, conversationId, 'oops');
    await owner.request({ method: 'DELETE', url: `/v1/messages/${m1.body.id}?scope=me` });
    expect((await messages(owner, conversationId)).map((m) => m.id)).not.toContain(m1.body.id);
    expect((await messages(visitor, conversationId)).map((m) => m.id)).toContain(m1.body.id);

    await visitor.request({ method: 'DELETE', url: `/v1/messages/${m1.body.id}?scope=everyone` });
    expect((await messages(visitor, conversationId)).find((m) => m.id === m1.body.id)).toMatchObject({ deleted: true, body: null });

    const m2 = await sendMessage(visitor, conversationId, 'old');
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '61 minutes' WHERE id = $1`, [m2.body.id]);
    const late = await visitor.request<{ error: { code: string } }>({ method: 'DELETE', url: `/v1/messages/${m2.body.id}?scope=everyone` });
    expect(late.body.error.code).toBe('DELETE_WINDOW_EXPIRED');
    const notMine = await owner.request<{ error: { code: string } }>({ method: 'DELETE', url: `/v1/messages/${m2.body.id}?scope=everyone` });
    expect(notMine.status).toBe(403);
  });
});

describe('retention, clear chat and closed chats (rules 7, 21, 23)', () => {
  it('changing retention posts a system message to both sides', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const res = await visitor.request<ConversationDto>({
      method: 'PATCH',
      url: `/v1/conversations/${conversationId}`,
      payload: { retention: 'd7' },
    });
    expect(res.body.retention).toBe('d7');
    expect((await messages(visitor, conversationId))[0]).toMatchObject({ type: 'system', system: { kind: 'retention_changed', byMe: true, value: 'd7' } });
    expect((await messages(owner, conversationId))[0]).toMatchObject({ type: 'system', system: { byMe: false, value: 'd7' } });
  });

  it('clear chat empties only my side', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await sendMessage(visitor, conversationId, 'one');
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/clear` });
    expect(await messages(owner, conversationId)).toEqual([]);
    expect((await messages(visitor, conversationId)).length).toBeGreaterThan(0);
  });

  it('when the other number is deleted the chat shows unavailable and refuses messages', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);
    await owner.request({ method: 'DELETE', url: `/v1/personas/${ownerNumber.id}`, payload: { confirm: 'DELETE' } });
    expect((await inbox(visitor)).items[0]?.unavailable).toBe(true);
    expect((await sendMessage(visitor, conversationId, 'hello?')).body.error?.code).toBe('NUMBER_UNAVAILABLE');
  });
});
