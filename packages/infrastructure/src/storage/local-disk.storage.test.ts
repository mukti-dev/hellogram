import { mkdtemp, rm, stat, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { LocalDiskStorage } from './local-disk.storage.js';

let root: string;
let storage: LocalDiskStorage;
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hg-media-'));
  storage = new LocalDiskStorage(root, '/media');
});
afterEach(() => rm(root, { recursive: true, force: true }));

const exists = (path: string) => stat(join(root, path)).then(() => true, () => false);

describe('LocalDiskStorage trash', () => {
  it('moves a trashed photo out of the served folder and destroys it only once it is old enough', async () => {
    await storage.put('avatars/abc.png', new Uint8Array([1, 2, 3]));
    await storage.trash('avatars/abc.png');
    expect(await exists('avatars/abc.png')).toBe(false);
    expect(await exists('trash/avatars/abc.png')).toBe(true);

    expect(await storage.purgeTrash(new Date(Date.now() - 60_000))).toBe(0);
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
    await utimes(join(root, 'trash/avatars/abc.png'), old, old);
    expect(await storage.purgeTrash(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000))).toBe(1);
    expect(await exists('trash/avatars/abc.png')).toBe(false);
  });

  it('ignores a photo that is already gone', async () => {
    await expect(storage.trash('avatars/missing.png')).resolves.toBeUndefined();
    expect(await storage.purgeTrash(new Date())).toBe(0);
  });
});
