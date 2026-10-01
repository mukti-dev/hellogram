import type { TrustedDeviceRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaTrustedDeviceRepository implements TrustedDeviceRepository {
  constructor(private readonly db: Db) {}

  async isTrusted(accountId: string, deviceHash: string): Promise<boolean> {
    const found = await this.db.trustedDevice.findUnique({
      where: { accountId_deviceHash: { accountId, deviceHash } },
      select: { id: true },
    });
    return Boolean(found);
  }

  async trust(accountId: string, deviceHash: string, at: Date): Promise<void> {
    await this.db.trustedDevice.upsert({
      where: { accountId_deviceHash: { accountId, deviceHash } },
      create: { accountId, deviceHash, createdAt: at, lastUsedAt: at },
      update: { lastUsedAt: at },
    });
  }

  async revoke(accountId: string, deviceHash: string): Promise<void> {
    await this.db.trustedDevice.deleteMany({ where: { accountId, deviceHash } });
  }

  async revokeAll(accountId: string): Promise<void> {
    await this.db.trustedDevice.deleteMany({ where: { accountId } });
  }
}
