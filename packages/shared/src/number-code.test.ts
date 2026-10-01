import { describe, expect, it } from 'vitest';
import { isValidNumberCode, normalizeNumberCode } from './number-code.js';

describe('number code format', () => {
  it.each(['A482719K', 'Z0000001B', 'a482719k'])('accepts %s', (code) => {
    expect(isValidNumberCode(code)).toBe(true);
  });

  it.each(['I482719K', 'A482719O', 'A48271K', 'A-482719-K', 'HG48271935', '4827193A', ''])(
    'rejects %s',
    (code) => {
      expect(isValidNumberCode(code)).toBe(false);
    },
  );

  it('normalizes case and whitespace', () => {
    expect(normalizeNumberCode(' a482719k ')).toBe('A482719K');
  });
});
