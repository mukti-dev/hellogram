import { CODE_LETTERS } from '@hellogram/shared';

/** Random integer in [0, max). Injected so generation is testable. */
export type RandomInt = (max: number) => number;

/**
 * Rejects digit blocks that look sequential or repeated, so codes don't feel
 * "vanity" or guessable (rule 6): 000000, 123456, 987654, 121212, 123123, 112233…
 */
export function isWeakDigitBlock(digits: string): boolean {
  if (/^(\d)\1+$/.test(digits)) return true;
  const nums = [...digits].map(Number);
  const steps = nums.slice(1).map((n, i) => n - nums[i]!);
  if (steps.every((s) => s === 1) || steps.every((s) => s === -1)) return true;
  for (const size of [1, 2, 3]) {
    if (digits.length % size !== 0 || size === digits.length) continue;
    const unit = digits.slice(0, size);
    if (unit.repeat(digits.length / size) === digits) return true;
  }
  // Pairs like 112233 / 001122
  if (/^(\d)\1(\d)\2(\d)\3\d*$/.test(digits)) return true;
  // Mostly one digit (e.g. 000010)
  const counts = new Map<string, number>();
  for (const d of digits) counts.set(d, (counts.get(d) ?? 0) + 1);
  return Math.max(...counts.values()) >= digits.length - 1;
}

/** Generates `L DDDDDD L`, e.g. A482719K. Uniqueness is checked by the caller. */
export function generateNumberCode(randomInt: RandomInt, digitCount = 6): string {
  const letter = () => CODE_LETTERS[randomInt(CODE_LETTERS.length)]!;
  for (;;) {
    const digits = Array.from({ length: digitCount }, () => randomInt(10)).join('');
    if (!isWeakDigitBlock(digits)) return `${letter()}${digits}${letter()}`;
  }
}
