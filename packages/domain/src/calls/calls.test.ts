import { describe, expect, it } from 'vitest';
import { outcomeFor, type Call } from './calls.js';

const base: Call = {
  id: 'c',
  conversationId: 'v',
  callerPersonaId: 'caller',
  calleePersonaId: 'callee',
  status: 'missed',
  endReason: 'no_answer',
  suppressed: false,
  createdAt: new Date(),
  answeredAt: null,
  endedAt: new Date(),
};

describe('call log outcomes (rule 31)', () => {
  it('busy, suppressed and plain no-answer all look the same to the caller', () => {
    for (const endReason of ['no_answer', 'busy', 'suppressed'] as const) {
      expect(outcomeFor({ ...base, endReason }, 'caller')).toBe('no_answer');
    }
  });
  it('declined calls look like no answer to the caller, declined to the callee', () => {
    const declined = { ...base, status: 'declined' as const, endReason: 'declined' as const };
    expect(outcomeFor(declined, 'caller')).toBe('no_answer');
    expect(outcomeFor(declined, 'callee')).toBe('declined');
  });
  it('answered calls are answered for both', () => {
    const answered = { ...base, status: 'ended' as const, endReason: 'completed' as const, answeredAt: new Date() };
    expect(outcomeFor(answered, 'caller')).toBe('answered');
    expect(outcomeFor(answered, 'callee')).toBe('answered');
  });
  it('the callee sees a missed call; a caller who hangs up sees cancelled', () => {
    const cancelled = { ...base, endReason: 'cancelled' as const };
    expect(outcomeFor(cancelled, 'callee')).toBe('missed');
    expect(outcomeFor(cancelled, 'caller')).toBe('cancelled');
  });
});
