import type { NativePushTokenRecord, NativePushTokenRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaNativePushTokenRepository implements NativePushTokenRepository {
  constructor(private readonly db: Db) {}

  async upsert(input: { accountId: string; sessionId: string; platform: 'ios' | 'android'; kind: 'voip' | 'alert'; token: string }) {
    await this.db.nativePushToken.upsert({
      where: { token: input.token },
      create: input,
      update: { accountId: input.accountId, sessionId: input.sessionId, platform: input.platform, kind: input.kind },
    });
  }

  async remove(accountId: string, token: string) {
    await this.db.nativePushToken.deleteMany({ where: { accountId, token } });
  }

  listForAccount(accountId: string, now: Date): Promise<NativePushTokenRecord[]> {
    return this.db.nativePushToken.findMany({
      where: { accountId, session: { revokedAt: null, expiresAt: { gt: now } } },
      select: { id: true, platform: true, kind: true, token: true },
    });
  }

  async deleteById(id: string) {
    await this.db.nativePushToken.deleteMany({ where: { id } });
  }
}
