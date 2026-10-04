import type { StorageProvider } from '@hellogram/domain';
import { mkdir, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path';

/**
 * Profile photos on local disk, served by the API under /media/avatars.
 * Trashed files move to `trash/`, which is never served, until purgeTrash destroys them.
 */
const TRASH = 'trash';

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

  async trash(key: string): Promise<void> {
    const to = this.pathFor(join(TRASH, key));
    await mkdir(dirname(to), { recursive: true });
    try {
      await rename(this.pathFor(key), to);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
      throw err;
    }
    // The trash clock starts now, not at upload.
    const now = new Date();
    await utimes(to, now, now);
  }

  async purgeTrash(before: Date): Promise<number> {
    let removed = 0;
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(path);
        } else if ((await stat(path)).mtime < before) {
          await rm(path, { force: true });
          removed += 1;
        }
      }
    };
    await walk(this.pathFor(TRASH));
    return removed;
  }

  publicUrl(key: string): string {
    return `${this.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
}
