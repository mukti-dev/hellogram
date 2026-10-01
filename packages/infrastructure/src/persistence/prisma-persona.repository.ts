import { Prisma } from '@hellogram/db';
import type { CreatePersonaInput, PauseReason, Persona, PersonaRepository, PersonaSettingsPatch } from '@hellogram/domain';
import { personaSelect, toPersona } from './mappers.js';
import type { Db } from './prisma-types.js';

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export class PrismaPersonaRepository implements PersonaRepository {
  constructor(private readonly db: Db) {}

  async findById(id: string): Promise<Persona | null> {
    const row = await this.db.persona.findUnique({ where: { id }, select: personaSelect });
    return row && toPersona(row);
  }

  async findByCode(code: string): Promise<Persona | null> {
    const row = await this.db.persona.findUnique({ where: { code }, select: personaSelect });
    return row && toPersona(row);
  }

  async listByAccount(accountId: string): Promise<Persona[]> {
    const rows = await this.db.persona.findMany({
      where: { accountId, status: { not: 'retired' } },
      orderBy: { createdAt: 'asc' },
      select: personaSelect,
    });
    return rows.map(toPersona);
  }

  countCreatedSince(accountId: string, since: Date): Promise<number> {
    return this.db.persona.count({ where: { accountId, createdAt: { gte: since } } });
  }

  async codeTaken(code: string): Promise<boolean> {
    const [persona, retired] = await Promise.all([
      this.db.persona.findUnique({ where: { code }, select: { id: true } }),
      this.db.retiredCode.findUnique({ where: { code } }),
    ]);
    return Boolean(persona || retired);
  }

  async create(input: CreatePersonaInput): Promise<Persona | null> {
    try {
      return toPersona(await this.db.persona.create({ data: input, select: personaSelect }));
    } catch (error) {
      if (isUniqueViolation(error)) return null;
      throw error;
    }
  }

  async update(id: string, patch: PersonaSettingsPatch): Promise<Persona> {
    return toPersona(await this.db.persona.update({ where: { id }, data: patch, select: personaSelect }));
  }

  async setStatus(id: string, status: 'active' | 'paused', pauseReason: PauseReason | null): Promise<Persona> {
    return toPersona(
      await this.db.persona.update({ where: { id }, data: { status, pauseReason }, select: personaSelect }),
    );
  }

  async markPaid(id: string, isPaid: boolean): Promise<void> {
    await this.db.persona.update({ where: { id }, data: { isPaid } });
  }

  /** Rule 7: retire = close all its conversations, expire its requests, never reuse its code. */
  async retire(id: string, at: Date): Promise<void> {
    const work = async (tx: Prisma.TransactionClient) => {
      const persona = await tx.persona.update({
        where: { id },
        data: { status: 'retired', retiredAt: at, pauseReason: null, pinHash: null },
        select: { code: true },
      });
      await tx.retiredCode.upsert({ where: { code: persona.code }, create: { code: persona.code }, update: {} });
      await tx.conversation.updateMany({
        where: { closedAt: null, OR: [{ personaAId: id }, { personaBId: id }] },
        data: { closedAt: at },
      });
      await tx.contactRequest.updateMany({
        where: { status: 'pending', OR: [{ fromPersonaId: id }, { toPersonaId: id }] },
        data: { status: 'expired', respondedAt: at },
      });
    };
    if ('$transaction' in this.db) {
      await this.db.$transaction(work);
    } else {
      await work(this.db);
    }
  }
}
