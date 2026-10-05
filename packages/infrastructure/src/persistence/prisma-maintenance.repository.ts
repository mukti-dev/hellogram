import type { MaintenanceRepository } from '@hellogram/domain';
import type { PrismaClient } from '@hellogram/db';

/** Bulk clean-up SQL for the worker. Rows keep their metadata until purgeOldMetadata. */
export class PrismaMaintenanceRepository implements MaintenanceRepository {
  constructor(private readonly db: PrismaClient) {}

  /** Rule 22: hidden from both sides once older than the conversation's retention. */
  expireContent(now: Date): Promise<number> {
    return this.db.$executeRaw`
      UPDATE messages m
         SET "expiredAt" = ${now}
        FROM conversations c
       WHERE m."conversationId" = c.id
         AND m."expiredAt" IS NULL
         AND m."contentPurgedAt" IS NULL
         AND m.type = 'text'
         AND c.retention <> 'forever'
         AND m."createdAt" < ${now}::timestamptz - (CASE c.retention
               WHEN 'd90' THEN interval '90 days'
               WHEN 'd30' THEN interval '30 days'
               WHEN 'd7'  THEN interval '7 days'
               WHEN 'h24' THEN interval '24 hours'
             END)`;
  }

  /** Soft-deleted and expired messages lose their text (and GIF link) for good; attachments.sweep then destroys their files. */
  eraseDeletedContent(before: Date, now: Date): Promise<number> {
    return this.db.$executeRaw`
      UPDATE messages
         SET body = NULL, gif = NULL, "contentPurgedAt" = ${now}
       WHERE "contentPurgedAt" IS NULL
         AND ("deletedForEveryoneAt" < ${before} OR "expiredAt" < ${before})`;
  }

  /** §9: message and call metadata is hard-deleted after 180 days. */
  async purgeOldMetadata(before: Date): Promise<{ messages: number; calls: number }> {
    const messages = await this.db.message.deleteMany({ where: { createdAt: { lt: before } } });
    const calls = await this.db.call.deleteMany({ where: { createdAt: { lt: before } } });
    return { messages: messages.count, calls: calls.count };
  }

  /** Report evidence lives until the report is closed + 180 days. */
  async purgeClosedReportEvidence(before: Date): Promise<number> {
    const { count } = await this.db.reportEvidence.deleteMany({
      where: { report: { closedAt: { lt: before } } },
    });
    return count;
  }

  async expireRequests(now: Date): Promise<number> {
    const { count } = await this.db.contactRequest.updateMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired', respondedAt: now },
    });
    return count;
  }

  async cleanupAuth(now: Date): Promise<number> {
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const otps = await this.db.otpChallenge.deleteMany({ where: { createdAt: { lt: dayAgo } } });
    const tokens = await this.db.refreshToken.deleteMany({ where: { usedAt: { lt: dayAgo } } });
    const sessions = await this.db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: now } }, { revokedAt: { lt: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) } }] },
    });
    return otps.count + tokens.count + sessions.count;
  }
}
