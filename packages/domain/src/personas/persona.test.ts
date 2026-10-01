import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { assertCanCreatePersona, normalizeDisplayName, normalizeLabel, planSummary } from './persona.js';

const p = (status: 'active' | 'paused' | 'retired', isPaid = false) => ({ status, isPaid });

describe('persona limits (rules 5 & 8)', () => {
  it('first two numbers are free, the third needs payment', () => {
    expect(assertCanCreatePersona([], 0)).toEqual({ requiresPayment: false });
    expect(assertCanCreatePersona([p('active')], 1)).toEqual({ requiresPayment: false });
    expect(assertCanCreatePersona([p('active'), p('paused')], 2)).toEqual({ requiresPayment: true });
  });

  it('retired numbers free their slot', () => {
    expect(assertCanCreatePersona([p('active'), p('retired')], 2)).toEqual({ requiresPayment: false });
  });

  it('max 5 active or paused numbers', () => {
    const five = [p('active'), p('active'), p('paused', true), p('active', true), p('active', true)];
    expect(() => assertCanCreatePersona(five, 0)).toThrow(DomainError);
  });

  it('max 3 new numbers per 7 days', () => {
    expect(() => assertCanCreatePersona([p('active')], 3)).toThrowError(/3 new numbers per week/);
  });

  it('summarises the plan like the design ("3 of 5 · 2 free · 1 paid")', () => {
    expect(planSummary([p('active'), p('active'), p('paused', true), p('retired')])).toEqual({
      used: 3,
      max: 5,
      free: 2,
      paid: 1,
      freeLeft: 0,
    });
  });
});

describe('persona fields', () => {
  it('trims and limits display names', () => {
    expect(normalizeDisplayName('  Rahul   Deals ')).toBe('Rahul Deals');
    expect(() => normalizeDisplayName('')).toThrow(DomainError);
    expect(() => normalizeDisplayName('x'.repeat(41))).toThrow(DomainError);
  });

  it('keeps custom text only for "other" labels (≤ 16 chars)', () => {
    expect(normalizeLabel('olx', 'ignored')).toEqual({ labelKind: 'olx', labelText: null });
    expect(normalizeLabel('other', 'Freelance')).toEqual({ labelKind: 'other', labelText: 'Freelance' });
    expect(() => normalizeLabel('other', 'x'.repeat(17))).toThrow(DomainError);
  });
});
