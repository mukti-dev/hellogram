import type { ConversationDto, IncomingRequestDto, InboxDto, MessagePageDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair, createNumber, sendMessage } from './fixtures.js';
import { assertNoAccountLeak, createHarness, type Harness, type User } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const inbox = async (u: User) => (await u.request<InboxDto>({ method: 'GET', url: '/v1/conversations' })).body.items;
const messages = async (u: User, id: string) =>
  (await u.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${id}/messages` })).body.items;

/** Owner with two numbers; creep chats with both, from two different numbers. */
async function twoChats() {
  const owner = await h.signUp();
  const creep = await h.signUp();
  const rahul = await createNumber(owner, 'Rahul');
  const coffee = await createNumber(owner, 'Coffee', { labelName: 'Dating', labelIcon: 'heart' });
  const creep1 = await createNumber(creep, 'Creep One');
  const creep2 = await createNumber(creep, 'Creep Two');
  for (const [from, to] of [[creep1, rahul], [creep2, coffee]] as const) {
    await creep.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: from.id, toCode: to.code, introMessage: 'hi' } });
  }
  const reqs = await owner.request<{ items: IncomingRequestDto[] }>({ method: 'GET', url: '/v1/requests' });
  const ids: Record<string, string> = {};
  for (const r of reqs.body.items) {
    const res = await owner.request<{ conversationId: string }>({ method: 'POST', url: `/v1/requests/${r.id}/accept` });
    ids[r.to.id] = res.body.conversationId;
  }
  return { owner, creep, rahul, coffee, creep1, creep2, chatA: ids[rahul.id]!, chatB: ids[coffee.id]! };
}

describe('block from a chat (rules 14–16, §6.3)', () => {
  it('hides the chat for the blocker; the blocked side sees "Unknown" only in that chat', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    expect((await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/block` })).status).toBe(204);

    expect(await inbox(owner)).toEqual([]);
    const theirs = (await inbox(visitor))[0]!;
    expect(theirs.counterpart).toMatchObject({ displayName: 'Unknown', code: null, avatarUrl: null, masked: true });
    expect(theirs.unavailable).toBe(false); // nothing says "blocked"

    // Their messages look sent (✓) forever and never reach the blocker.
    const sent = await sendMessage(visitor, conversationId, 'hello??');
    expect(sent.status).toBe(201);
    expect(sent.body.status).toBe('sent');
    const ownerView = await h.db.query(`SELECT suppressed FROM messages WHERE id = $1`, [sent.body.id]);
    expect(ownerView.rows[0].suppressed).toBe(true);
  });

  it('never links numbers: other chats between the two accounts go silent both ways, without any visible change', async () => {
    const { owner, creep, chatA, chatB } = await twoChats();
    await owner.request({ method: 'POST', url: `/v1/conversations/${chatA}/block` });

    // Creep's other chat (with "Coffee") looks completely normal.
    const creepChatB = (await inbox(creep)).find((c) => c.id === chatB)!;
    expect(creepChatB.counterpart).toMatchObject({ displayName: 'Coffee', masked: false });

    // Creep → Coffee: accepted, one tick, never delivered.
    const fromCreep = await sendMessage(creep, chatB, 'still there?');
    expect(fromCreep.body.status).toBe('sent');
    expect((await messages(owner, chatB)).map((m) => m.body)).not.toContain('still there?');
    expect((await inbox(owner)).find((c) => c.id === chatB)?.unread).toBe(1); // only the intro

    // Owner → Creep via Coffee: also silently suppressed.
    const fromOwner = await sendMessage(owner, chatB, 'bye');
    expect(fromOwner.body.status).toBe('sent');
    expect((await messages(creep, chatB)).map((m) => m.body)).not.toContain('bye');

    // Coffee chat stays visible for the owner and unmasked for the creep.
    expect((await inbox(owner)).map((c) => c.id)).toEqual([chatB]);
  });

  it('unblock restores the chat on both sides; earlier suppressed messages stay undelivered', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/block` });
    await sendMessage(visitor, conversationId, 'during block');
    const blocks = await owner.request<{ items: { id: string }[] }>({ method: 'GET', url: '/v1/blocks' });
    await owner.request({ method: 'DELETE', url: `/v1/blocks/${blocks.body.items[0]!.id}` });

    expect((await inbox(owner)).map((c) => c.id)).toEqual([conversationId]);
    expect((await inbox(visitor))[0]?.counterpart.masked).toBe(false);
    expect((await messages(owner, conversationId)).map((m) => m.body)).not.toContain('during block');
    await sendMessage(visitor, conversationId, 'after unblock');
    expect((await messages(owner, conversationId)).map((m) => m.body)).toContain('after unblock');
  });
});

describe('reports with evidence (rules 33–34)', () => {
  it('snapshots the last 50 messages, survives clearing and purging, and blocks by default', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    for (let i = 0; i < 55; i++) {
      if (i % 25 === 0) await h.container.redis?.flushdb(); // stay under the 30/min per-number limit
      await sendMessage(visitor, conversationId, `msg ${i}`);
    }
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/clear` });

    const res = await owner.request<{ id: string }>({
      method: 'POST',
      url: '/v1/reports',
      payload: { conversationId, reason: 'harassment', note: 'keeps messaging' },
    });
    expect(res.status).toBe(201);
    const evidence = await h.db.query(`SELECT snapshot FROM report_evidence WHERE "reportId" = $1`, [res.body.id]);
    const snapshot = evidence.rows[0].snapshot as { body: string; senderDisplayName: string }[];
    expect(snapshot).toHaveLength(50);
    expect(snapshot.at(-1)).toMatchObject({ body: 'msg 54', senderDisplayName: 'Amit Kumar' });
    expect(JSON.stringify(snapshot)).not.toMatch(/accountId|phone|nickname/);

    // alsoBlock defaults to true.
    expect((await owner.request<{ items: unknown[] }>({ method: 'GET', url: '/v1/blocks' })).body.items).toHaveLength(1);

    // Content purge doesn't touch the snapshot.
    await h.db.query(`UPDATE conversations SET retention = 'h24'`);
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '2 days'`);
    await h.container.maintenanceService.expireContent();
    await h.db.query(`UPDATE messages SET "expiredAt" = now() - interval '31 days'`);
    await h.container.maintenanceService.eraseDeletedContent();
    const again = await h.db.query(`SELECT snapshot FROM report_evidence WHERE "reportId" = $1`, [res.body.id]);
    expect((again.rows[0].snapshot as { body: string }[]).at(-1)?.body).toBe('msg 54');
  });

  it('reports a request with its intro as evidence, optionally without blocking', async () => {
    const owner = await h.signUp();
    const spammer = await h.signUp();
    const target = await createNumber(owner, 'T');
    const from = await createNumber(spammer, 'S');
    await spammer.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: from.id, toCode: target.code, introMessage: 'buy crypto now' } });
    const [req] = (await owner.request<{ items: IncomingRequestDto[] }>({ method: 'GET', url: '/v1/requests' })).body.items;
    const res = await owner.request({ method: 'POST', url: '/v1/reports', payload: { requestId: req!.id, reason: 'spam', alsoBlock: false } });
    expect(res.status).toBe(201);
    const ev = await h.db.query(`SELECT snapshot FROM report_evidence`);
    expect(ev.rows[0].snapshot[0]).toMatchObject({ type: 'intro', body: 'buy crypto now' });
    expect((await owner.request<{ items: unknown[] }>({ method: 'GET', url: '/v1/blocks' })).body.items).toHaveLength(0);
  });
});

describe('retention sweeper and metadata purge (rules 21–22, §9)', () => {
  it('hides messages past the chat’s retention, then erases them 30 days later', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await owner.request<ConversationDto>({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { retention: 'd7' } });
    const old = await sendMessage(visitor, conversationId, 'old secret');
    const fresh = await sendMessage(visitor, conversationId, 'fresh');
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '8 days' WHERE id = $1`, [old.body.id]);

    expect(await h.container.maintenanceService.expireContent()).toBeGreaterThanOrEqual(1);
    const page = await owner.request<{ items: { id: string; body: string | null }[] }>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` });
    expect(page.body.items.find((m) => m.id === old.body.id)?.body ?? null).toBeNull();
    expect(JSON.stringify(page.body)).not.toContain('old secret');
    const kept = await h.db.query(`SELECT body, "expiredAt" FROM messages WHERE id = $1`, [old.body.id]);
    expect(kept.rows[0].body).toBe('old secret');
    expect(kept.rows[0].expiredAt).not.toBeNull();

    expect(await h.container.maintenanceService.eraseDeletedContent()).toBe(0);
    await h.db.query(`UPDATE messages SET "expiredAt" = now() - interval '31 days' WHERE id = $1`, [old.body.id]);
    expect(await h.container.maintenanceService.eraseDeletedContent()).toBe(1);
    const rows = await h.db.query(`SELECT id, body, "contentPurgedAt" FROM messages WHERE id = ANY($1::uuid[])`, [[old.body.id, fresh.body.id]]);
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r]));
    expect(byId[old.body.id]).toMatchObject({ body: null });
    expect(byId[old.body.id].contentPurgedAt).not.toBeNull();
    expect(byId[fresh.body.id]).toMatchObject({ body: 'fresh', contentPurgedAt: null });
  });

  it('custom history: messages older than the chat’s own minutes disappear', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await owner.request({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { retention: 'custom', retentionMinutes: 5 } });
    const old = await sendMessage(visitor, conversationId, 'six minutes old');
    const fresh = await sendMessage(visitor, conversationId, 'four minutes old');
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '6 minutes' WHERE id = $1`, [old.body.id]);
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '4 minutes' WHERE id = $1`, [fresh.body.id]);

    await h.container.maintenanceService.expireContent();
    const rows = await h.db.query(`SELECT id, "expiredAt" FROM messages WHERE id = ANY($1::uuid[])`, [[old.body.id, fresh.body.id]]);
    const byId = Object.fromEntries(rows.rows.map((r) => [r.id, r.expiredAt]));
    expect(byId[old.body.id]).not.toBeNull();
    expect(byId[fresh.body.id]).toBeNull();
    // Gone from the chat for both sides; the notice about the change stays.
    for (const u of [owner, visitor]) {
      const items = await messages(u, conversationId);
      expect(items.map((m) => m.id)).not.toContain(old.body.id);
      expect(items.map((m) => m.id)).toContain(fresh.body.id);
      expect(items.some((m) => m.type === 'system')).toBe(true);
    }
    expect(JSON.stringify(await inbox(owner))).not.toContain('six minutes old');

    // A longer custom time keeps them: 60 minutes.
    await owner.request({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { retention: 'custom', retentionMinutes: 60 } });
    const kept = await sendMessage(visitor, conversationId, 'thirty minutes old');
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '30 minutes' WHERE id = $1`, [kept.body.id]);
    await h.container.maintenanceService.expireContent();
    expect((await h.db.query(`SELECT "expiredAt" FROM messages WHERE id = $1`, [kept.body.id])).rows[0].expiredAt).toBeNull();
  });

  it('a message deleted for everyone is gone for both sides but stays in report evidence for 30 days', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const msg = await sendMessage(visitor, conversationId, 'threatening words');
    expect((await visitor.request({ method: 'DELETE', url: `/v1/messages/${msg.body.id}?scope=everyone` })).status).toBe(204);
    for (const user of [owner, visitor]) {
      const page = await user.request({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` });
      expect(JSON.stringify(page.body)).not.toContain('threatening words');
    }
    const res = await owner.request<{ id: string }>({ method: 'POST', url: '/v1/reports', payload: { conversationId, reason: 'harassment' } });
    const evidence = await h.db.query(`SELECT snapshot FROM report_evidence WHERE "reportId" = $1`, [res.body.id]);
    expect(evidence.rows[0].snapshot.at(-1)).toMatchObject({ body: 'threatening words', deleted: true });
  });

  it('"forever" chats are never purged; metadata older than 180 days is hard-deleted', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    await visitor.request({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { retention: 'forever' } });
    const m = await sendMessage(visitor, conversationId, 'keep me');
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '100 days' WHERE id = $1`, [m.body.id]);
    await h.container.maintenanceService.expireContent();
    expect((await h.db.query(`SELECT "expiredAt" FROM messages WHERE id = $1`, [m.body.id])).rows[0].expiredAt).toBeNull();

    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '181 days' WHERE id = $1`, [m.body.id]);
    await h.container.maintenanceService.purgeOldMetadata();
    expect((await h.db.query(`SELECT 1 FROM messages WHERE id = $1`, [m.body.id])).rowCount).toBe(0);
  });
});

describe('golden rule: no account-level data about other users, anywhere', () => {
  it('inbox, conversation, messages, requests, public card and blocks never leak it', async () => {
    const { owner, visitor, conversationId, ownerNumber } = await connectedPair(h);
    await sendMessage(visitor, conversationId, 'hello');
    for (const user of [owner, visitor]) {
      for (const url of [
        '/v1/conversations',
        `/v1/conversations/${conversationId}`,
        `/v1/conversations/${conversationId}/messages`,
        '/v1/requests',
        '/v1/requests/sent',
        '/v1/blocks',
        '/v1/personas',
      ]) {
        const res = await user.request({ method: 'GET', url });
        expect(res.status).toBe(200);
        assertNoAccountLeak(res.body);
        expect(JSON.stringify(res.body)).not.toMatch(/\+91\d{10}/);
      }
    }
    const pub = await h.app.inject({ method: 'GET', url: `/v1/public/numbers/${ownerNumber.code}` });
    assertNoAccountLeak(pub.json());
  });
});
