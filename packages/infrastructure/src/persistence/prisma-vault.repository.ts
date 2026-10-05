import { Prisma } from '@hellogram/db';
import type { PinState, VaultPins, VaultRepository, VaultSpace, VaultState } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

const COLUMNS = {
  lock: { failed: 'lockFailedCount', level: 'lockLockLevel', until: 'lockLockedUntil' },
  hide: { failed: 'hideFailedCount', level: 'hideLockLevel', until: 'hideLockedUntil' },
} as const;

const toState = (failed: number, level: number, until: Date | null): PinState => ({
  pinFailedCount: failed,
  pinLockLevel: level,
  pinLockedUntil: until,
});

export class PrismaVaultRepository implements VaultRepository {
  constructor(private readonly db: Db) {}

  async getPins(accountId: string): Promise<VaultPins> {
    const row = await this.db.chatVault.findUnique({ where: { accountId } });
    return {
      lockPinHash: row?.lockPinHash ?? null,
      lock: toState(row?.lockFailedCount ?? 0, row?.lockLockLevel ?? 0, row?.lockLockedUntil ?? null),
      hide: toState(row?.hideFailedCount ?? 0, row?.hideLockLevel ?? 0, row?.hideLockedUntil ?? null),
    };
  }

  async setLockPinHash(accountId: string, hash: string): Promise<void> {
    const data = { lockPinHash: hash, lockFailedCount: 0, lockLockLevel: 0, lockLockedUntil: null };
    await this.db.chatVault.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
  }

  async reserveAttempt(accountId: string, which: 'lock' | 'hide', now: Date) {
    await this.db.chatVault.upsert({ where: { accountId }, create: { accountId }, update: {} });
    const c = COLUMNS[which];
    const rows = await this.db.$queryRaw<{ failedCount: number; lockLevel: number }[]>`
      UPDATE chat_vaults SET ${Prisma.raw(`"${c.failed}" = "${c.failed}" + 1`)}
       WHERE "accountId" = ${accountId}::uuid
         AND (${Prisma.raw(`"${c.until}"`)} IS NULL OR ${Prisma.raw(`"${c.until}"`)} <= ${now})
       RETURNING ${Prisma.raw(`"${c.failed}" AS "failedCount", "${c.level}" AS "lockLevel"`)}`;
    return rows[0] ?? null;
  }

  async setPinState(accountId: string, which: 'lock' | 'hide', state: PinState): Promise<void> {
    const c = COLUMNS[which];
    const data = { [c.failed]: state.pinFailedCount, [c.level]: state.pinLockLevel, [c.until]: state.pinLockedUntil };
    await this.db.chatVault.upsert({ where: { accountId }, create: { accountId, ...data }, update: data });
  }

  listSpaces(accountId: string): Promise<VaultSpace[]> {
    return this.db.vaultSpace.findMany({ where: { accountId }, select: { id: true, pinHash: true }, orderBy: { createdAt: 'asc' } });
  }

  createSpace(accountId: string, pinHash: string): Promise<VaultSpace> {
    return this.db.vaultSpace.create({ data: { accountId, pinHash }, select: { id: true, pinHash: true } });
  }

  async setState(conversationId: string, personaId: string, state: VaultState | null, spaceId: string | null): Promise<void> {
    await this.db.conversationMember.update({
      where: { conversationId_personaId: { conversationId, personaId } },
      data: { vault: state, vaultSpaceId: state === 'hidden' ? spaceId : null },
    });
  }

  async counts(personaIds: string[]): Promise<{ archived: number; locked: number }> {
    if (personaIds.length === 0) return { archived: 0, locked: 0 };
    const rows = await this.db.conversationMember.groupBy({
      by: ['vault'],
      where: { personaId: { in: personaIds }, hiddenAt: null, vault: { in: ['archived', 'locked'] } },
      _count: { _all: true },
    });
    const count = (state: VaultState) => rows.find((r) => r.vault === state)?._count._all ?? 0;
    return { archived: count('archived'), locked: count('locked') };
  }

  async unhideAll(accountId: string): Promise<void> {
    await this.db.conversationMember.updateMany({
      where: { vault: 'hidden', persona: { accountId } },
      data: { vault: null, vaultSpaceId: null },
    });
    await this.db.vaultSpace.deleteMany({ where: { accountId } });
  }
}
