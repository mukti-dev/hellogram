import type { RefreshTokenRecord, Session, SessionRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

const select = {
  id: true,
  accountId: true,
  deviceName: true,
  userAgent: true,
  deviceHash: true,
  createdAt: true,
  lastSeenAt: true,
  expiresAt: true,
  revokedAt: true,
} as const;

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly db: Db) {}

  create(input: {
    accountId: string;
    deviceName: string | null;
    userAgent: string | null;
    ipHash: string;
    expiresAt: Date;
  }): Promise<Session> {
    return this.db.session.create({ data: input, select });
  }

  findById(id: string): Promise<Session | null> {
    return this.db.session.findUnique({ where: { id }, select });
  }

  listActive(accountId: string, now: Date): Promise<Session[]> {
    return this.db.session.findMany({
      where: { accountId, revokedAt: null, expiresAt: { gt: now } },
      orderBy: { lastSeenAt: 'desc' },
      select,
    });
  }

  async touch(sessionId: string, at: Date): Promise<void> {
    await this.db.session.update({ where: { id: sessionId }, data: { lastSeenAt: at } });
  }

  async revoke(sessionId: string, reason: string, at: Date): Promise<void> {
    await this.db.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: at, revokeReason: reason },
    });
  }

  async addRefreshToken(sessionId: string, tokenHash: string): Promise<void> {
    await this.db.refreshToken.create({ data: { sessionId, tokenHash } });
  }

  findRefreshToken(tokenHash: string): Promise<RefreshTokenRecord | null> {
    return this.db.refreshToken.findUnique({
      where: { tokenHash },
      select: { id: true, sessionId: true, usedAt: true, session: { select } },
    });
  }

  async markRefreshTokenUsed(tokenId: string, at: Date): Promise<boolean> {
    // Conditional update = atomic compare-and-set; concurrent reuse can't both win.
    const { count } = await this.db.refreshToken.updateMany({
      where: { id: tokenId, usedAt: null },
      data: { usedAt: at },
    });
    return count === 1;
  }
}
