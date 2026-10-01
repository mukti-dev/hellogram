import type { BlobStore } from '@hellogram/domain';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SAFE_KEY = /^[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)*$/;

/**
 * Development stand-in for S3: encrypted files in a local folder.
 * The folder must not be inside the public media directory — nothing here is served directly.
 */
export class LocalDiskBlobStore implements BlobStore {
  constructor(private readonly rootDir: string) {}

  private pathFor(key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error('Invalid storage key');
    return join(this.rootDir, key);
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    try {
      return await readFile(this.pathFor(key));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }
}

/** For tests. */
export class InMemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, Uint8Array>();

  async put(key: string, body: Uint8Array): Promise<void> {
    this.objects.set(key, body);
  }

  async get(key: string): Promise<Uint8Array | null> {
    return this.objects.get(key) ?? null;
  }

  async delete(key: string): Promise<void> {
    this.objects.delete(key);
  }
}
