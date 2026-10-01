import type { PushSubscriptionRecord, PushSubscriptionRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaPushSubscriptionRepository implements PushSubscriptionRepository {
  constructor(private readonly db: Db) {}

  async upsert(input: { accountId: string; sessionId: string; endpoint: string; p256dh: string; auth: string }) {
    await this.db.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: input,
      update: { accountId: input.accountId, sessionId: input.sessionId, p256dh: input.p256dh, auth: input.auth },
    });
  }

  async remove(accountId: string, endpoint: string) {
    await this.db.pushSubscription.deleteMany({ where: { accountId, endpoint } });
  }

  listForAccount(accountId: string): Promise<PushSubscriptionRecord[]> {
    return this.db.pushSubscription.findMany({
      where: { accountId },
      select: { id: true, endpoint: true, p256dh: true, auth: true },
    });
  }

  async deleteById(id: string) {
    await this.db.pushSubscription.deleteMany({ where: { id } });
  }
}
