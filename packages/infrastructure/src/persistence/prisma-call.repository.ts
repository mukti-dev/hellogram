import type { Call, CallEndReason, CallRepository, CallStatus, CallWithParties } from '@hellogram/domain';
import { decodeCursor, encodeCursor, olderThan } from './cursor.js';
import { personaSelect, toPersona } from './mappers.js';
import type { Db } from './prisma-types.js';

const callSelect = {
  id: true,
  conversationId: true,
  callerPersonaId: true,
  calleePersonaId: true,
  status: true,
  endReason: true,
  suppressed: true,
  createdAt: true,
  answeredAt: true,
  endedAt: true,
} as const;

const withParties = { ...callSelect, caller: { select: personaSelect }, callee: { select: personaSelect } } as const;

type Row = Call & { caller: Parameters<typeof toPersona>[0]; callee: Parameters<typeof toPersona>[0] };
const toCall = (r: Row): CallWithParties => ({ ...r, caller: toPersona(r.caller), callee: toPersona(r.callee) });

export class PrismaCallRepository implements CallRepository {
  constructor(private readonly db: Db) {}

  async create(input: { conversationId: string; callerPersonaId: string; calleePersonaId: string; suppressed: boolean }): Promise<Call> {
    return this.db.call.create({ data: input, select: callSelect });
  }

  async findWithParties(id: string): Promise<CallWithParties | null> {
    const row = await this.db.call.findUnique({ where: { id }, select: withParties });
    return row && toCall(row);
  }

  async transition(
    id: string,
    from: CallStatus[],
    to: { status: CallStatus; endReason?: CallEndReason | null; answeredAt?: Date; endedAt?: Date },
  ): Promise<boolean> {
    const { count } = await this.db.call.updateMany({ where: { id, status: { in: from } }, data: to });
    return count === 1;
  }

  async listForPersonas(personaIds: string[], cursor: string | null, limit: number) {
    const rows = await this.db.call.findMany({
      where: {
        AND: [
          {
            OR: [
              { callerPersonaId: { in: personaIds } },
              // A suppressed call never reached the callee, so it isn't in their log.
              { calleePersonaId: { in: personaIds }, suppressed: false },
            ],
          },
          olderThan(decodeCursor(cursor)),
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select: withParties,
    });
    const items = rows.slice(0, limit).map(toCall);
    const last = items.at(-1);
    return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
  }

  async staleRinging(before: Date): Promise<string[]> {
    const rows = await this.db.call.findMany({ where: { status: 'ringing', createdAt: { lt: before } }, select: { id: true } });
    return rows.map((r) => r.id);
  }
}
