import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { PIN_RESET, afterFailedPin, assertNotLockedOut, assertValidPin, type PinState } from './pin.js';

const NOW = new Date('2026-09-28T10:00:00Z');
const minutes = (s: PinState) => (s.pinLockedUntil ? (s.pinLockedUntil.getTime() - NOW.getTime()) / 60_000 : 0);

describe('PIN rules (rules 24, 26)', () => {
  it('PINs are exactly 4 digits', () => {
    expect(() => assertValidPin('1234')).not.toThrow();
    for (const bad of ['123', '12345', 'abcd', '12 4']) expect(() => assertValidPin(bad)).toThrow(DomainError);
  });

  it('5 wrong PINs lock for 15 minutes', () => {
    let s = PIN_RESET;
    for (let i = 0; i < 4; i++) {
      s = afterFailedPin(s, NOW);
      expect(s.pinLockedUntil).toBeNull();
    }
    s = afterFailedPin(s, NOW);
    expect(minutes(s)).toBe(15);
    expect(() => assertNotLockedOut(s, NOW)).toThrowError(/Too many wrong PINs/);
    expect(() => assertNotLockedOut(s, new Date(NOW.getTime() + 16 * 60_000))).not.toThrow();
  });

  it('further failures double the lock, capped at 24 hours', () => {
    let s: PinState = { pinFailedCount: 0, pinLockLevel: 1, pinLockedUntil: null };
    const seen: number[] = [];
    for (let i = 0; i < 9; i++) {
      s = afterFailedPin(s, NOW);
      seen.push(minutes(s));
    }
    expect(seen.slice(0, 5)).toEqual([30, 60, 120, 240, 480]);
    expect(seen.at(-1)).toBe(24 * 60);
  });
});
