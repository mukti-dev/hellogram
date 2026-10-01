import type { AccountSnapshot, ReachRepository, ReachSnapshot } from '@hellogram/domain';
import { personaSelect, toPersona } from './mappers.js';
import type { Db } from './prisma-types.js';

const accountSnap = { id: true, status: true, suspendedUntil: true } as const;

export class PrismaReachRepository implements ReachRepository {
  constructor(private readonly db: Db) {}

  async load(actorPersonaId: string, targetPersonaId: string): Promise<ReachSnapshot | null> {
    const select = { ...personaSelect, account: { select: accountSnap } };
    const [actor, target] = await Promise.all([
      this.db.persona.findUnique({ where: { id: actorPersonaId }, select }),
      this.db.persona.findUnique({ where: { id: targetPersonaId }, select }),
    ]);
    if (!actor || !target) return null;
    const { account: actorAccount, ...actorRow } = actor;
    const { account: targetAccount, ...targetRow } = target;
    return {
      actorAccount,
      actorPersona: toPersona(actorRow),
      targetAccount,
      targetPersona: toPersona(targetRow),
      blocked: await this.isBlockedBetween(actorAccount.id, targetAccount.id),
    };
  }

  accountSnapshot(accountId: string): Promise<AccountSnapshot | null> {
    return this.db.account.findUnique({ where: { id: accountId }, select: accountSnap });
  }

  async isBlockedBetween(accountA: string, accountB: string): Promise<boolean> {
    if (accountA === accountB) return false;
    const found = await this.db.block.findFirst({
      where: {
        OR: [
          { blockerAccountId: accountA, blockedAccountId: accountB },
          { blockerAccountId: accountB, blockedAccountId: accountA },
        ],
      },
      select: { id: true },
    });
    return Boolean(found);
  }
}
