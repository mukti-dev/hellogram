import type { PinHasher } from '@hellogram/domain';
import argon2 from 'argon2';

/** argon2id for PINs (low-entropy secrets need a slow, memory-hard hash). */
export class Argon2PinHasher implements PinHasher {
  hash(pin: string): Promise<string> {
    return argon2.hash(pin, { type: argon2.argon2id, memoryCost: 19_456, timeCost: 2, parallelism: 1 });
  }

  async verify(hash: string, pin: string): Promise<boolean> {
    try {
      return await argon2.verify(hash, pin);
    } catch {
      return false;
    }
  }
}
