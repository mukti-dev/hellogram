import type { BlockRecord, BlockRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

const select = {
  id: true,
  blockerPersonaId: true,
  blockedPersonaId: true,
  conversationId: true,
  createdAt: true,
  blockerPersona: { select: { code: true } },
  blockedPersona: { select: { code: true, displayName: true } },
} as const;

type Row = {
  id: string;
  blockerPersonaId: string;
  blockedPersonaId: string;
  conversationId: string | null;
  createdAt: Date;
  blockerPersona: { code: string };
  blockedPersona: { code: string; displayName: string };
};

const toRecord = (r: Row): BlockRecord => ({
  id: r.id,
  blockerPersonaId: r.blockerPersonaId,
  blockerPersonaCode: r.blockerPersona.code,
  blockedPersonaId: r.blockedPersonaId,
  blockedPersonaCode: r.blockedPersona.code,
  blockedDisplayName: r.blockedPersona.displayName,
  conversationId: r.conversationId,
  createdAt: r.createdAt,
});

export class PrismaBlockRepository implements BlockRepository {
  constructor(private readonly db: Db) {}

  async create(input: Parameters<BlockRepository['create']>[0]): Promise<BlockRecord> {
    const row = await this.db.block.upsert({
      where: {
        blockerPersonaId_blockedPersonaId: {
          blockerPersonaId: input.blockerPersonaId,
          blockedPersonaId: input.blockedPersonaId,
        },
      },
      create: input,
      update: {},
      select,
    });
    return toRecord(row);
  }

  async listByBlocker(blockerAccountId: string): Promise<BlockRecord[]> {
    const rows = await this.db.block.findMany({ where: { blockerAccountId }, orderBy: { createdAt: 'desc' }, select });
    return rows.map(toRecord);
  }

  async findOwned(id: string, blockerAccountId: string): Promise<BlockRecord | null> {
    const row = await this.db.block.findFirst({ where: { id, blockerAccountId }, select });
    return row && toRecord(row);
  }

  async delete(id: string): Promise<void> {
    await this.db.block.delete({ where: { id } });
  }
}
