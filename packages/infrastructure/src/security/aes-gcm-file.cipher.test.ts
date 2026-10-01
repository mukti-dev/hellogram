import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { AesGcmFileCipher } from './aes-gcm-file.cipher.js';

const key = () => randomBytes(32).toString('base64');
const text = (bytes: Uint8Array) => Buffer.from(bytes).toString('utf8');

describe('AesGcmFileCipher', () => {
  it('round-trips and never stores the plaintext', () => {
    const cipher = new AesGcmFileCipher(key());
    const plain = Buffer.from('a private photo '.repeat(200));
    const sealed = cipher.seal(plain, 'att/abc');
    expect(Buffer.from(sealed).includes(Buffer.from('a private photo'))).toBe(false);
    expect(text(cipher.open(sealed, 'att/abc'))).toBe(plain.toString());
  });

  it('uses a fresh key and nonce per file', () => {
    const cipher = new AesGcmFileCipher(key());
    const a = Buffer.from(cipher.seal(Buffer.from('same'), 'k'));
    const b = Buffer.from(cipher.seal(Buffer.from('same'), 'k'));
    expect(a.equals(b)).toBe(false);
  });

  it('rejects tampering anywhere in the object', () => {
    const cipher = new AesGcmFileCipher(key());
    const sealed = Buffer.from(cipher.seal(Buffer.from('hello world'), 'k'));
    for (const at of [0, 5, 10, 25, 40, sealed.length - 1]) {
      const copy = Buffer.from(sealed);
      copy[at] = (copy[at] ?? 0) ^ 0x01;
      expect(() => cipher.open(copy, 'k')).toThrow();
    }
    expect(() => cipher.open(sealed.subarray(0, sealed.length - 3), 'k')).toThrow();
  });

  it('binds the object to its storage key (no swapping)', () => {
    const cipher = new AesGcmFileCipher(key());
    const sealed = cipher.seal(Buffer.from('mine'), 'att/one');
    expect(() => cipher.open(sealed, 'att/two')).toThrow();
  });

  it('cannot be opened with a different key', () => {
    const sealed = new AesGcmFileCipher(key()).seal(Buffer.from('secret'), 'k');
    expect(() => new AesGcmFileCipher(key()).open(sealed, 'k')).toThrow(/No key available/);
  });

  it('keeps old files readable after a key rotation', () => {
    const oldKey = key();
    const sealedOld = new AesGcmFileCipher(oldKey).seal(Buffer.from('before rotation'), 'k');
    const rotated = new AesGcmFileCipher(key(), [oldKey]);
    expect(text(rotated.open(sealedOld, 'k'))).toBe('before rotation');
    const sealedNew = rotated.seal(Buffer.from('after rotation'), 'k');
    expect(() => new AesGcmFileCipher(oldKey).open(sealedNew, 'k')).toThrow();
  });

  it('refuses keys that are not 32 bytes', () => {
    expect(() => new AesGcmFileCipher('c2hvcnQ=')).toThrow(/32 bytes/);
  });
});
