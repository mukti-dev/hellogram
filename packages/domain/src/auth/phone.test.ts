import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { formatIndianMobile, normalizeEmail, normalizeIndianMobile } from './phone.js';

describe('normalizeIndianMobile', () => {
  it.each(['9876543210', '+919876543210', '919876543210', '09876543210', '98765 43210', '+91 98765-43210'])(
    'normalizes %s',
    (input) => expect(normalizeIndianMobile(input)).toBe('+919876543210'),
  );

  it.each(['5876543210', '987654321', '98765432100', '+449876543210', 'abc', ''])('rejects %s', (input) => {
    expect(() => normalizeIndianMobile(input)).toThrow(DomainError);
  });

  it('formats for display', () => {
    expect(formatIndianMobile('+919876543210')).toBe('+91 98765 43210');
  });

  it('lower-cases and trims emails', () => {
    expect(normalizeEmail('  Mukti@Example.COM ')).toBe('mukti@example.com');
  });
});
