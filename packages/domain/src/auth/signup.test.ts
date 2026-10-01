import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { ageOn, assertStrongPassword, parseAdultDateOfBirth, parseGender } from './signup.js';

const NOW = new Date('2026-10-02T06:30:00Z'); // 12:00 IST
const code = (fn: () => unknown) => {
  try {
    fn();
    return 'ok';
  } catch (e) {
    return e instanceof DomainError ? e.code : 'other';
  }
};

describe('age', () => {
  it('counts whole years by calendar date', () => {
    expect(ageOn(new Date('2008-10-02'), new Date('2026-10-02'))).toBe(18);
    expect(ageOn(new Date('2008-10-03'), new Date('2026-10-02'))).toBe(17);
    expect(ageOn(new Date('2000-02-29'), new Date('2026-02-28'))).toBe(25);
  });

  it('accepts 18 and over, refuses under 18 and impossible dates', () => {
    expect(parseAdultDateOfBirth('2008-10-02', NOW).toISOString().slice(0, 10)).toBe('2008-10-02');
    expect(code(() => parseAdultDateOfBirth('2008-10-03', NOW))).toBe('UNDER_AGE');
    expect(code(() => parseAdultDateOfBirth('2020-01-01', NOW))).toBe('UNDER_AGE');
    for (const bad of ['2001-02-30', '02-10-2000', '2030-01-01', '1890-01-01', '']) {
      expect(code(() => parseAdultDateOfBirth(bad, NOW))).toBe('VALIDATION_FAILED');
    }
  });

  it('uses India time: someone turns 18 on their birthday in IST even before UTC midnight', () => {
    // 2026-10-01 20:00 UTC is already 2 Oct 01:30 in India.
    expect(code(() => parseAdultDateOfBirth('2008-10-02', new Date('2026-10-01T20:00:00Z')))).toBe('ok');
    expect(code(() => parseAdultDateOfBirth('2008-10-02', new Date('2026-10-01T18:00:00Z')))).toBe('UNDER_AGE');
  });
});

describe('gender and password', () => {
  it('accepts only the listed genders', () => {
    expect(parseGender('female')).toBe('female');
    expect(code(() => parseGender('robot'))).toBe('VALIDATION_FAILED');
  });

  it('wants 8+ characters and nothing trivially guessable', () => {
    expect(code(() => assertStrongPassword('Sunrise!42', '+919876543210'))).toBe('ok');
    for (const weak of ['short', 'password', '12345678', 'aaaaaaaa', 'x9876543210', 'Hellogram123']) {
      expect(code(() => assertStrongPassword(weak, '+919876543210'))).toBe('VALIDATION_FAILED');
    }
    expect(code(() => assertStrongPassword('x'.repeat(129), '+919876543210'))).toBe('VALIDATION_FAILED');
  });
});
