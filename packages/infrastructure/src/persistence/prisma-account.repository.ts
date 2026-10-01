import type { Account, AccountRepository } from '@hellogram/domain';
import type { Gender } from '@hellogram/shared';
import type { Db } from './prisma-types.js';

const select = {
  id: true,
  phone: true,
  name: true,
  dateOfBirth: true,
  gender: true,
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

  create(input: {
    phone: string;
    name: string;
    passwordHash: string;
    dateOfBirth: Date;
    gender: Gender;
    ageConfirmedAt: Date;
    consentVersion: string;
    ipHash: string;
  }): Promise<Account> {
    return this.db.account.create({
      data: {
        phone: input.phone,
        name: input.name,
        passwordHash: input.passwordHash,
        dateOfBirth: input.dateOfBirth,
        gender: input.gender,
        ageConfirmedAt: input.ageConfirmedAt,
        consents: { create: { version: input.consentVersion, acceptedAt: input.ageConfirmedAt, ipHash: input.ipHash } },
      },
      select,
    });
  }

  async setVerifiedEmail(accountId: string, email: string, verifiedAt: Date): Promise<void> {
    await this.db.account.update({ where: { id: accountId }, data: { email, emailVerifiedAt: verifiedAt } });
  }

  async findPasswordHash(accountId: string): Promise<string | null> {
    return (await this.db.account.findUnique({ where: { id: accountId }, select: { passwordHash: true } }))?.passwordHash ?? null;
  }

  async setPasswordHash(accountId: string, passwordHash: string): Promise<void> {
    await this.db.account.update({ where: { id: accountId }, data: { passwordHash } });
  }

  async setName(accountId: string, name: string): Promise<void> {
    await this.db.account.update({ where: { id: accountId }, data: { name } });
  }

  async isEmailTaken(email: string, exceptAccountId: string): Promise<boolean> {
    const found = await this.db.account.findFirst({ where: { email, id: { not: exceptAccountId } }, select: { id: true } });
    return Boolean(found);
  }
}
