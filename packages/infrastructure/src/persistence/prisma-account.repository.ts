import type { Account, AccountRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

const select = {
  id: true,
  phone: true,
  email: true,
  emailVerifiedAt: true,
  status: true,
  suspendedUntil: true,
  createdAt: true,
} as const;

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly db: Db) {}

  findById(id: string): Promise<Account | null> {
    return this.db.account.findUnique({ where: { id }, select });
  }

  findByPhone(phone: string): Promise<Account | null> {
    return this.db.account.findUnique({ where: { phone }, select });
  }

  findByVerifiedEmail(email: string): Promise<Account | null> {
    return this.db.account.findFirst({ where: { email, emailVerifiedAt: { not: null } }, select });
  }

  create(input: { phone: string; ageConfirmedAt: Date; consentVersion: string; ipHash: string }): Promise<Account> {
    return this.db.account.create({
      data: {
        phone: input.phone,
        ageConfirmedAt: input.ageConfirmedAt,
        consents: { create: { version: input.consentVersion, acceptedAt: input.ageConfirmedAt, ipHash: input.ipHash } },
      },
      select,
    });
  }

  async setVerifiedEmail(accountId: string, email: string, verifiedAt: Date): Promise<void> {
    await this.db.account.update({ where: { id: accountId }, data: { email, emailVerifiedAt: verifiedAt } });
  }

  async isEmailTaken(email: string, exceptAccountId: string): Promise<boolean> {
    const found = await this.db.account.findFirst({ where: { email, id: { not: exceptAccountId } }, select: { id: true } });
    return Boolean(found);
  }
}
