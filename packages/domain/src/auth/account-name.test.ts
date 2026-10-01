import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { normalizeAccountName } from './account-name.js';

describe('normalizeAccountName', () => {
  it('tidies spacing and keeps any script', () => {
    expect(normalizeAccountName('  Mukti   Prasad ')).toBe('Mukti Prasad');
    expect(normalizeAccountName('मुक्ति')).toBe('मुक्ति');
    expect(normalizeAccountName('A\u0000nita\n')).toBe('Anita');
  });

  it('refuses empty, symbol-only and over-long names', () => {
    for (const bad of ['', '   ', '1234', '!!!', 'x'.repeat(51)]) expect(() => normalizeAccountName(bad)).toThrow(DomainError);
    expect(normalizeAccountName('x'.repeat(50))).toHaveLength(50);
  });
});
