import type { CallLogEntryDto, CallStartDto, IncomingCallEvent } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { connectedPair } from './fixtures.js';
import { createHarness, type Harness, type User } from './harness.js';

let h: Harness;
beforeAll(async () => {
  h = await createHarness();
});
afterAll(async () => h.close());
beforeEach(async () => h.reset());

const start = (u: User, conversationId: string) =>
  u.request<CallStartDto & { error?: { code: string } }>({ method: 'POST', url: '/v1/calls', payload: { conversationId } });
const log = async (u: User) => (await u.request<{ items: CallLogEntryDto[] }>({ method: 'GET', url: '/v1/calls' })).body.items;
const row = (callId: string) => h.db.query(`SELECT status, "endReason", suppressed FROM calls WHERE id = $1`, [callId]).then((r) => r.rows[0]);

describe('voice calls (rules 29–32)', () => {
  it('returns relay-only TURN credentials bound to the call', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const res = await start(visitor, conversationId);
    expect(res.status).toBe(201);
    expect(res.body.iceTransportPolicy).toBe('relay');
    expect(res.body.ringSeconds).toBe(45);
    const [server] = res.body.iceServers;
    expect(server?.urls.every((u) => u.startsWith('turn'))).toBe(true);
    expect(server?.username).toMatch(new RegExp(`^\\d+:${res.body.callId}$`));
  });

  it('ring → accept → end writes a completed call to both logs', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { body } = await start(visitor, conversationId);
    expect((await owner.request({ method: 'POST', url: `/v1/calls/${body.callId}/accept` })).status).toBe(200);
    expect((await visitor.request({ method: 'POST', url: `/v1/calls/${body.callId}/end` })).status).toBe(204);
    expect(await row(body.callId)).toMatchObject({ status: 'ended', endReason: 'completed' });
    expect((await log(visitor))[0]).toMatchObject({ direction: 'outgoing', outcome: 'answered' });
    expect((await log(owner))[0]).toMatchObject({ direction: 'incoming', outcome: 'answered', counterpart: { displayName: 'Amit Kumar' } });
  });

  it('decline looks like no answer to the caller', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { body } = await start(visitor, conversationId);
    await owner.request({ method: 'POST', url: `/v1/calls/${body.callId}/decline` });
    expect((await log(visitor))[0]?.outcome).toBe('no_answer');
    expect((await log(owner))[0]?.outcome).toBe('declined');
  });

  it('calls off, DND and busy all ring out as "no answer" — the callee never hears it', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);

    await owner.request({ method: 'PATCH', url: `/v1/personas/${ownerNumber.id}`, payload: { allowCalls: false } });
    const off = await start(visitor, conversationId);
    expect(off.status).toBe(201); // looks exactly like a normal ringing call
    expect(await row(off.body.callId)).toMatchObject({ status: 'ringing', suppressed: true });
    expect((await owner.request({ method: 'POST', url: `/v1/calls/${off.body.callId}/accept` })).status).toBe(404);
    await h.container.callService.timeout(off.body.callId);
    expect(await log(owner)).toEqual([]); // never shown to the callee
    expect((await log(visitor))[0]?.outcome).toBe('no_answer');

    await owner.request({ method: 'PATCH', url: `/v1/personas/${ownerNumber.id}`, payload: { allowCalls: true, dndUntil: '2099-01-01T00:00:00.000Z' } });
    const dnd = await start(visitor, conversationId);
    expect(await row(dnd.body.callId)).toMatchObject({ suppressed: true });
    await h.container.callService.timeout(dnd.body.callId);
  });

  it('one active call per account: a second caller gets the same "no answer" as a busy line', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const first = await start(visitor, conversationId);
    await owner.request({ method: 'POST', url: `/v1/calls/${first.body.callId}/accept` });

    // A third person calls the owner (who is busy) on the same number.
    const third = await h.signUp();
    const { createNumber } = await import('./fixtures.js');
    const t = await createNumber(third, 'Third');
    const ownerCode = (await owner.request<{ items: { code: string }[] }>({ method: 'GET', url: '/v1/personas' })).body.items[0]!.code;
    await third.request({ method: 'POST', url: '/v1/requests', payload: { fromPersonaId: t.id, toCode: ownerCode } });
    const req = (await owner.request<{ items: { id: string }[] }>({ method: 'GET', url: '/v1/requests' })).body.items[0]!;
    const conv = (await owner.request<{ conversationId: string }>({ method: 'POST', url: `/v1/requests/${req.id}/accept` })).body.conversationId;

    const busy = await start(third, conv);
    expect(busy.status).toBe(201);
    expect(await row(busy.body.callId)).toMatchObject({ suppressed: true });

    // The busy caller can't start a second call of their own either.
    const again = await start(visitor, conversationId);
    expect(again.body.error?.code).toBe('CALL_NOT_ALLOWED');
  });

  it('ringing times out to missed after 45 s; hanging up while ringing is cancelled', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const a = await start(visitor, conversationId);
    await h.container.callService.timeout(a.body.callId);
    expect(await row(a.body.callId)).toMatchObject({ status: 'missed', endReason: 'no_answer' });
    expect((await log(owner))[0]?.outcome).toBe('missed');

    const b = await start(visitor, conversationId);
    await visitor.request({ method: 'POST', url: `/v1/calls/${b.body.callId}/end` });
    expect(await row(b.body.callId)).toMatchObject({ status: 'missed', endReason: 'cancelled' });
    expect((await log(visitor))[0]?.outcome).toBe('cancelled');
    // Accepting a finished call fails.
    expect((await owner.request({ method: 'POST', url: `/v1/calls/${b.body.callId}/accept` })).status).toBe(422);
  });

  it('blocked chats ring out silently too', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/block` });
    const res = await start(visitor, conversationId);
    expect(res.status).toBe(201);
    expect(await row(res.body.callId)).toMatchObject({ suppressed: true });
  });

  it('outsiders cannot touch a call', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const { body } = await start(visitor, conversationId);
    const stranger = await h.signUp();
    expect((await stranger.request({ method: 'POST', url: `/v1/calls/${body.callId}/accept` })).status).toBe(404);
    expect((await stranger.request({ method: 'POST', url: `/v1/calls/${body.callId}/end` })).status).toBe(404);
  });
});

describe('incoming-call notifications', () => {
  /** What the push notifications are built from (the push itself goes through the worker queue). */
  const captured = { incoming: [] as Record<string, unknown>[], ended: [] as Record<string, unknown>[] };
  beforeAll(() => {
    h.container.events.subscribe('call.incoming', async (e) => void captured.incoming.push(e.payload as Record<string, unknown>));
    h.container.events.subscribe('call.ended', async (e) => void captured.ended.push(e.payload as Record<string, unknown>));
  });
  const tokenFor = (callId: string) => captured.incoming.find((p) => p.callId === callId)?.declineToken as string;
  const endedFor = (callId: string) => captured.ended.find((p) => p.callId === callId);
  const declineFromNotification = (callId: string, token: string) =>
    h.app.inject({ method: 'POST', url: `/v1/calls/${callId}/decline-from-notification`, payload: { token } });

  it('a device opened from the notification can fetch the ringing call — only the callee, only while ringing', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { body } = await start(visitor, conversationId);
    const ringing = await owner.request<IncomingCallEvent>({ method: 'GET', url: `/v1/calls/${body.callId}` });
    expect(ringing.status).toBe(200);
    expect(ringing.body).toMatchObject({ callId: body.callId, conversationId, caller: { displayName: 'Amit Kumar' } });
    expect((await visitor.request({ method: 'GET', url: `/v1/calls/${body.callId}` })).status).toBe(404);
    expect((await (await h.signUp()).request({ method: 'GET', url: `/v1/calls/${body.callId}` })).status).toBe(404);
    await visitor.request({ method: 'POST', url: `/v1/calls/${body.callId}/end` });
    expect((await owner.request({ method: 'GET', url: `/v1/calls/${body.callId}` })).status).toBe(404);
  });

  it('the notification’s Decline works without a session, but only with that call’s key', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const a = (await start(visitor, conversationId)).body;
    const token = tokenFor(a.callId);
    expect(token).toBeTruthy();

    // A wrong key, or another call's key, changes nothing — and looks the same (204).
    expect((await declineFromNotification(a.callId, 'x'.repeat(43))).statusCode).toBe(204);
    expect(await row(a.callId)).toMatchObject({ status: 'ringing' });

    expect((await declineFromNotification(a.callId, token)).statusCode).toBe(204);
    expect(await row(a.callId)).toMatchObject({ status: 'declined', endReason: 'declined' });
    expect((await log(visitor))[0]?.outcome).toBe('no_answer');
    expect((await log(owner))[0]?.outcome).toBe('declined');
    expect(endedFor(a.callId)).toMatchObject({ missed: false });

    // Replaying the key on a finished call does nothing.
    expect((await declineFromNotification(a.callId, token)).statusCode).toBe(204);
    const b = (await start(visitor, conversationId)).body;
    expect((await declineFromNotification(b.callId, token)).statusCode).toBe(204);
    expect(await row(b.callId)).toMatchObject({ status: 'ringing' });
  });

  it('the ringing notification becomes "Missed call" only when the callee never answered', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const cancelled = (await start(visitor, conversationId)).body;
    await visitor.request({ method: 'POST', url: `/v1/calls/${cancelled.callId}/end` });
    expect(endedFor(cancelled.callId)).toMatchObject({ missed: true });

    const answered = (await start(visitor, conversationId)).body;
    await owner.request({ method: 'POST', url: `/v1/calls/${answered.callId}/accept` });
    await owner.request({ method: 'POST', url: `/v1/calls/${answered.callId}/end` });
    expect(endedFor(answered.callId)).toMatchObject({ missed: false });

    const declined = (await start(visitor, conversationId)).body;
    await owner.request({ method: 'POST', url: `/v1/calls/${declined.callId}/decline` });
    expect(endedFor(declined.callId)).toMatchObject({ missed: false });
  });
});
