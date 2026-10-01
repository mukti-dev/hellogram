import type { FileCipher } from '@hellogram/domain';
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

/**
 * File encryption at the application layer: whatever reaches object storage is ciphertext.
 *
 * Layout: magic(4) | keyId(4) | salt(16) | iv(12) | ciphertext | tag(16)
 * - Every file gets its own AES-256-GCM key: HKDF-SHA256(master key, random salt).
 * - The header and the caller's `context` (the storage key) are authenticated, so an object
 *   can't be altered, truncated or swapped for another one without detection.
 * - `keyId` says which master key sealed the file, so keys can be rotated: new files use the
 *   current key, older files stay readable while their key is listed in `previousKeys`.
 */
const MAGIC = Buffer.from([0x48, 0x47, 0x46, 0x01]); // "HGF" + format version 1
const KEY_ID_BYTES = 4;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + KEY_ID_BYTES + SALT_BYTES + IV_BYTES;
const INFO = Buffer.from('hellogram/attachment/v1');

export function parseFileKey(base64: string): Buffer {
  const key = Buffer.from(base64.trim(), 'base64');
  if (key.length !== 32) throw new Error('File encryption keys must be 32 bytes, base64-encoded (openssl rand -base64 32)');
  return key;
}

const keyIdOf = (key: Buffer) => createHash('sha256').update('hellogram/file-key-id').update(key).digest().subarray(0, KEY_ID_BYTES);

export class AesGcmFileCipher implements FileCipher {
  private readonly current: { id: Buffer; key: Buffer };
  private readonly keys = new Map<string, Buffer>();

  constructor(currentKey: string, previousKeys: string[] = []) {
    const [current, ...previous] = [currentKey, ...previousKeys].map(parseFileKey) as [Buffer, ...Buffer[]];
    this.current = { id: keyIdOf(current), key: current };
    for (const key of [current, ...previous]) this.keys.set(keyIdOf(key).toString('hex'), key);
  }

  private static fileKey(master: Buffer, salt: Buffer): Buffer {
    return Buffer.from(hkdfSync('sha256', master, salt, INFO, 32));
  }

  seal(plain: Uint8Array, context: string): Uint8Array {
    const salt = randomBytes(SALT_BYTES);
    const iv = randomBytes(IV_BYTES);
    const header = Buffer.concat([MAGIC, this.current.id, salt, iv]);
    const cipher = createCipheriv('aes-256-gcm', AesGcmFileCipher.fileKey(this.current.key, salt), iv);
    cipher.setAAD(Buffer.concat([header, Buffer.from(context, 'utf8')]));
    const body = Buffer.concat([cipher.update(plain), cipher.final()]);
    return Buffer.concat([header, body, cipher.getAuthTag()]);
  }

  open(sealed: Uint8Array, context: string): Uint8Array {
    const data = Buffer.from(sealed.buffer, sealed.byteOffset, sealed.byteLength);
    if (data.length < HEADER_BYTES + TAG_BYTES || !data.subarray(0, MAGIC.length).equals(MAGIC)) {
      throw new Error('Not an encrypted Hellogram file');
    }
    const keyId = data.subarray(MAGIC.length, MAGIC.length + KEY_ID_BYTES);
    const salt = data.subarray(MAGIC.length + KEY_ID_BYTES, HEADER_BYTES - IV_BYTES);
    const iv = data.subarray(HEADER_BYTES - IV_BYTES, HEADER_BYTES);
    const master = this.keys.get(keyId.toString('hex'));
    if (!master) throw new Error('No key available for this file (was the encryption key changed without keeping the old one?)');

    const decipher = createDecipheriv('aes-256-gcm', AesGcmFileCipher.fileKey(master, salt), iv);
    decipher.setAAD(Buffer.concat([data.subarray(0, HEADER_BYTES), Buffer.from(context, 'utf8')]));
    decipher.setAuthTag(data.subarray(data.length - TAG_BYTES));
    // final() throws unless the tag verifies, so unauthenticated plaintext is never returned.
    return Buffer.concat([decipher.update(data.subarray(HEADER_BYTES, data.length - TAG_BYTES)), decipher.final()]);
  }
}
