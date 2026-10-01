import type { TotpVerifier } from '@hellogram/domain';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.replace(/=+$/, '').toUpperCase().replace(/\s/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of clean) {
    const idx = ALPHABET.indexOf(char);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as used by Google Authenticator / Authy. */
export function totpAt(secret: string, at: Date, step = 30): string {
  const counter = Math.floor(at.getTime() / 1000 / step);
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const hmac = createHmac('sha1', base32Decode(secret)).update(msg).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1_000_000;
  return String(code).padStart(6, '0');
}

export class Totp implements TotpVerifier {
  constructor(private readonly issuer = 'Hellogram Admin') {}

  generateSecret(): string {
    return base32Encode(randomBytes(20));
  }

  /** Accepts the current code and one step either side (clock drift). */
  verify(secret: string, code: string, at: Date): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    return [-1, 0, 1].some((drift) => {
      const expected = Buffer.from(totpAt(secret, new Date(at.getTime() + drift * 30_000)));
      const given = Buffer.from(code);
      return expected.length === given.length && timingSafeEqual(expected, given);
    });
  }

  otpauthUrl(secret: string, label: string): string {
    const issuer = encodeURIComponent(this.issuer);
    return `otpauth://totp/${issuer}:${encodeURIComponent(label)}?secret=${secret}&issuer=${issuer}&algorithm=SHA1&digits=6&period=30`;
  }
}
