import { NUMBER_CODE_PATTERN } from '@hellogram/shared';
import { describe, expect, it } from 'vitest';
import { generateNumberCode, isWeakDigitBlock } from './number-code.js';

const seq = (values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length]!;
};

describe('number codes (rule 6)', () => {
  it.each(['000000', '111111', '123456', '987654', '121212', '123123', '112233', '000010', '999989'])(
    'rejects weak digit block %s',
    (digits) => expect(isWeakDigitBlock(digits)).toBe(true),
  );

  it.each(['482719', '619028', '305677', '740318'])('accepts %s', (digits) => {
    expect(isWeakDigitBlock(digits)).toBe(false);
  });

  it('produces letter + 6 digits + letter, without I or O', () => {
    for (let i = 0; i < 2000; i++) {
      const code = generateNumberCode((max) => Math.floor(Math.random() * max));
      expect(code).toMatch(NUMBER_CODE_PATTERN);
      expect(code).toMatch(/^[^IO]\d{6}[^IO]$/);
    }
  });

  it('skips weak digit blocks', () => {
    // Digits are drawn first: 111111 (weak) is skipped, then 482719, then the two letters.
    const values = [1, 1, 1, 1, 1, 1, 4, 8, 2, 7, 1, 9, 0, 0];
    const code = generateNumberCode(seq(values));
    expect(code.slice(1, 7)).toBe('482719');
  });

  it('supports 7 digits for later expansion', () => {
    expect(generateNumberCode((max) => Math.floor(Math.random() * max), 7)).toMatch(/^[A-Z]\d{7}[A-Z]$/);
  });
});
