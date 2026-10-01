import type { OtpChallenge, OtpChallengeRepository, OtpChannel, OtpPurpose } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaOtpChallengeRepository implements OtpChallengeRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    channel: OtpChannel;
    targetHash: string;
    purpose: OtpPurpose;
    codeHash: string;
    providerRef?: string | null;
    expiresAt: Date;
    ipHash: string;
  }): Promise<void> {
    await this.db.otpChallenge.create({ data: input });
  }

  findLatestOpen(targetHash: string, purpose: OtpPurpose, now: Date): Promise<OtpChallenge | null> {
    return this.db.otpChallenge.findFirst({
      where: { targetHash, purpose, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        channel: true,
        targetHash: true,
        purpose: true,
        codeHash: true,
        providerRef: true,
        attempts: true,
        expiresAt: true,
        consumedAt: true,
      },
    }) as Promise<OtpChallenge | null>;
  }

  async reserveAttempt(id: string, maxAttempts: number): Promise<boolean> {
    const { count } = await this.db.otpChallenge.updateMany({
      where: { id, attempts: { lt: maxAttempts }, consumedAt: null },
      data: { attempts: { increment: 1 } },
    });
    return count === 1;
  }

  async consume(id: string, at: Date): Promise<boolean> {
    const { count } = await this.db.otpChallenge.updateMany({ where: { id, consumedAt: null }, data: { consumedAt: at } });
    return count === 1;
  }
}
