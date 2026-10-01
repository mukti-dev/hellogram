import type { StorageProvider } from '@hellogram/domain';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

/**
 * Development storage: files on local disk, served by the API under /media.
 * Production swaps in an S3 implementation behind the same port.
 */
export class LocalDiskStorage implements StorageProvider {
  constructor(
    private readonly rootDir: string,
    private readonly publicBaseUrl: string,
  ) {}

  private pathFor(key: string): string {
    const safe = normalize(key).replace(/^(\.\.(\/|\\|$))+/, '');
    return join(this.rootDir, safe);
  }

  async put(key: string, body: Uint8Array): Promise<void> {
    const path = this.pathFor(key);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, body);
  }

  async delete(key: string): Promise<void> {
    await rm(this.pathFor(key), { force: true });
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}
