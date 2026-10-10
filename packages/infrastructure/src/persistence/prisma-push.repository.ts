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

  /** Only browsers whose session is still signed in (logged out or expired: no notifications). */
  async listForAccount(accountId: string): Promise<PushSubscriptionRecord[]> {
    const subs = await this.db.pushSubscription.findMany({
      where: { accountId, sessionId: { not: null } },
      select: { id: true, sessionId: true, endpoint: true, p256dh: true, auth: true },
    });
    if (!subs.length) return [];
    const live = await this.db.session.findMany({
      where: { id: { in: subs.map((s) => s.sessionId!) }, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
    const liveIds = new Set(live.map((s) => s.id));
    return subs.filter((s) => liveIds.has(s.sessionId!)).map(({ sessionId: _, ...sub }) => sub);
  }

  async deleteById(id: string) {
    await this.db.pushSubscription.deleteMany({ where: { id } });
  }
}
