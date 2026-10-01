import type { PinRepository, PinState } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaPinRepository implements PinRepository {
  constructor(private readonly db: Db) {}

  getPinState(personaId: string) {
    return this.db.persona.findUnique({
      where: { id: personaId },
      select: { pinHash: true, pinFailedCount: true, pinLockLevel: true, pinLockedUntil: true, accountId: true },
    });
  }

  async setPinHash(personaId: string, hash: string | null): Promise<void> {
    await this.db.persona.update({
      where: { id: personaId },
      data: { pinHash: hash, pinFailedCount: 0, pinLockLevel: 0, pinLockedUntil: null },
    });
  }

  async setPinState(personaId: string, state: PinState): Promise<void> {
    await this.db.persona.update({ where: { id: personaId }, data: state });
  }

  async reserveAttempt(personaId: string, now: Date) {
    const rows = await this.db.$queryRaw<{ pinHash: string; pinFailedCount: number; pinLockLevel: number }[]>`
      UPDATE personas SET "pinFailedCount" = "pinFailedCount" + 1
       WHERE id = ${personaId}::uuid AND "pinHash" IS NOT NULL
         AND ("pinLockedUntil" IS NULL OR "pinLockedUntil" <= ${now})
       RETURNING "pinHash", "pinFailedCount", "pinLockLevel"`;
    return rows[0] ?? null;
  }

  async clearAllHistory(personaId: string, at: Date): Promise<void> {
    await this.db.conversationMember.updateMany({ where: { personaId }, data: { clearedBefore: at } });
  }
}
