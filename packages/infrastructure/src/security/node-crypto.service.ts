import type { CryptoService } from '@hellogram/domain';
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

/**
 * HMAC-SHA256 with a per-purpose key derived from one server secret.
 * Refresh tokens are 256-bit random values, so a keyed hash is enough and lets us
 * look them up by index (argon2id is reserved for low-entropy PINs).
 */
export class NodeCryptoService implements CryptoService {
  private readonly keys: Map<string, Buffer>;

  constructor(secret: string) {
    this.keys = new Map(
      (['target', 'ip', 'refresh', 'otp'] as const).map((purpose) => [
        purpose,
        createHmac('sha256', secret).update(`hellogram:${purpose}`).digest(),
      ]),
    );
  }

  hmac(purpose: 'target' | 'ip' | 'refresh' | 'otp', value: string): string {
    const key = this.keys.get(purpose);
    if (!key) throw new Error(`Unknown hmac purpose ${purpose}`);
    return createHmac('sha256', key).update(value).digest('base64url');
  }

  randomToken(bytes = 32): string {
    return randomBytes(bytes).toString('base64url');
  }

  randomDigits(length: number): string {
    return Array.from({ length }, () => randomInt(0, 10)).join('');
  }

  randomInt(max: number): number {
    return randomInt(0, max);
  }

  safeEqual(a: string, b: string): boolean {
    const left = Buffer.from(a);
    const right = Buffer.from(b);
    return left.length === right.length && timingSafeEqual(left, right);
  }
}
