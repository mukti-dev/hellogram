import { describe, expect, it } from 'vitest';
import { Totp, base32Decode, base32Encode, totpAt } from './totp.js';

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 test vector: secret "12345678901234567890" (ASCII), SHA-1.
  const secret = base32Encode(Buffer.from('12345678901234567890'));

  it('matches the RFC test vectors (last 6 digits)', () => {
    expect(totpAt(secret, new Date(59 * 1000))).toBe('287082');
    expect(totpAt(secret, new Date(1111111109 * 1000))).toBe('081804');
    expect(totpAt(secret, new Date(1234567890 * 1000))).toBe('005924');
  });

  it('round-trips base32', () => {
    expect(base32Decode(base32Encode(Buffer.from('hello world'))).toString()).toBe('hello world');
  });

  it('accepts ±1 step of drift and rejects others', () => {
    const totp = new Totp();
    const s = totp.generateSecret();
    const now = new Date('2026-09-28T10:00:00Z');
    expect(totp.verify(s, totpAt(s, now), now)).toBe(true);
    expect(totp.verify(s, totpAt(s, new Date(now.getTime() - 30_000)), now)).toBe(true);
    expect(totp.verify(s, totpAt(s, new Date(now.getTime() - 120_000)), now)).toBe(false);
    expect(totp.verify(s, 'abcdef', now)).toBe(false);
  });
});
