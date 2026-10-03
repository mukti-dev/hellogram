import type { ConversationRepository } from '@hellogram/domain';
import { describe, expect, it } from 'vitest';
import { FakeClock, FakePersonas } from '../testing/fakes.js';
import { PushTriggers } from './push-triggers.js';

const setup = async (calleeLocked = false) => {
  const personas = new FakePersonas();
  const base = { labelIcon: 'tag' as const, isPaid: false, allowCalls: true, allowMedia: true };
  const caller = await personas.create({ ...base, accountId: 'acc-caller', code: 'A1234567B', displayName: 'Amit Kumar', labelName: 'Buying' });
  const callee = await personas.create({ ...base, accountId: 'acc-callee', code: 'C7654321D', displayName: 'Rahul Deals', labelName: 'OLX' });
  callee.hasPin = calleeLocked;
  const triggers = new PushTriggers({ personas, conversations: {} as ConversationRepository, clock: new FakeClock() });
  return { triggers, caller, callee };
};

describe('incoming-call notifications', () => {
  it('ring even while the app is open, expire with the ring, and carry the Decline key', async () => {
    const { triggers, caller, callee } = await setup();
    const intent = triggers.forCall({ callId: 'call-1', caller, callee, calleeLocked: false, declineToken: 'key' });
    expect(intent).toMatchObject({
      accountId: 'acc-callee',
      onlyIfOffline: false,
      payload: {
        kind: 'call',
        callId: 'call-1',
        declineToken: 'key',
        title: 'Incoming call from Amit Kumar',
        body: 'to C7654321D',
        url: '/inbox?call=call-1',
        tag: 'call-call-1',
        ttlSeconds: 45,
      },
    });
  });

  it('never name the caller on a PIN-locked number (rule 27)', async () => {
    const { triggers, caller, callee } = await setup(true);
    const ring = triggers.forCall({ callId: 'c', caller, callee, calleeLocked: true });
    expect(JSON.stringify(ring.payload)).not.toMatch(/Amit|Rahul/);
    const missed = await triggers.forCallEnded({ callId: 'c', callerPersonaId: caller.id, calleePersonaId: callee.id, suppressed: false, missed: true });
    expect(missed?.payload.title).toBe('Missed call');
    expect(JSON.stringify(missed?.payload)).not.toMatch(/Amit|Rahul/);
  });

  it('turn into "Missed call" when unanswered, and just clear otherwise', async () => {
    const { triggers, caller, callee } = await setup();
    const ids = { callId: 'c', callerPersonaId: caller.id, calleePersonaId: callee.id, suppressed: false };
    expect((await triggers.forCallEnded({ ...ids, missed: true }))?.payload).toMatchObject({
      kind: 'call_ended',
      missed: true,
      title: 'Missed call from Amit Kumar',
      tag: 'call-c',
    });
    expect((await triggers.forCallEnded({ ...ids, missed: false }))?.payload).toMatchObject({ kind: 'call_ended', missed: false, tag: 'call-c' });
    expect((await triggers.forCallEnded({ ...ids, answered: true }))?.payload).toMatchObject({ kind: 'call_answered', missed: false });
  });

  it('stay silent for calls the callee was never told about (blocked, busy, calls off)', async () => {
    const { triggers, caller, callee } = await setup();
    expect(await triggers.forCallEnded({ callId: 'c', callerPersonaId: caller.id, calleePersonaId: callee.id, suppressed: true, missed: true })).toBeNull();
  });
});
