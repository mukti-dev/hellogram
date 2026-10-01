import type { ContactRequest, Page, RequestRepository, RequestStatus } from '@hellogram/domain';
import { decodeCursor, encodeCursor, olderThan } from './cursor.js';
import { personaSelect, toPersona } from './mappers.js';
import type { Db } from './prisma-types.js';

const select = {
  id: true,
  introMessage: true,
  status: true,
  suppressed: true,
  createdAt: true,
  respondedAt: true,
  expiresAt: true,
  from: { select: personaSelect },
  to: { select: personaSelect },
} as const;

type Row = {
  id: string;
  introMessage: string;
  status: RequestStatus;
  suppressed: boolean;
  createdAt: Date;
  respondedAt: Date | null;
  expiresAt: Date;
  from: Parameters<typeof toPersona>[0];
  to: Parameters<typeof toPersona>[0];
};

const toRequest = ({ from, to, ...row }: Row): ContactRequest => ({
  ...row,
  fromPersona: toPersona(from),
  toPersona: toPersona(to),
});

function page(rows: Row[], limit: number): Page<ContactRequest> {
  const items = rows.slice(0, limit).map(toRequest);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > limit && last ? encodeCursor(last.createdAt, last.id) : null };
}

export class PrismaRequestRepository implements RequestRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    fromPersonaId: string;
    toPersonaId: string;
    introMessage: string;
    suppressed: boolean;
    expiresAt: Date;
  }): Promise<ContactRequest> {
    return toRequest(await this.db.contactRequest.create({ data: input, select }));
  }

  async findById(id: string): Promise<ContactRequest | null> {
    const row = await this.db.contactRequest.findUnique({ where: { id }, select });
    return row && toRequest(row);
  }

  async listIncoming(personaIds: string[], status: 'pending' | 'blocked', cursor: string | null, limit: number) {
    const rows = await this.db.contactRequest.findMany({
      where: { toPersonaId: { in: personaIds }, status, suppressed: false, ...olderThan(decodeCursor(cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select,
    });
    return page(rows, limit);
  }

  async listSent(personaIds: string[], cursor: string | null, limit: number) {
    const rows = await this.db.contactRequest.findMany({
      where: { fromPersonaId: { in: personaIds }, ...olderThan(decodeCursor(cursor)) },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      select,
    });
    return page(rows, limit);
  }

  countPendingIncoming(personaIds: string[]): Promise<number> {
    return this.db.contactRequest.count({
      where: { toPersonaId: { in: personaIds }, status: 'pending', suppressed: false },
    });
  }

  async pendingExists(fromAccountId: string, toPersonaId: string): Promise<boolean> {
    const found = await this.db.contactRequest.findFirst({
      where: { toPersonaId, status: { in: ['pending', 'blocked'] }, from: { accountId: fromAccountId } },
      select: { id: true },
    });
    return Boolean(found);
  }

  async declinedSince(fromAccountId: string, toPersonaId: string, since: Date): Promise<boolean> {
    const found = await this.db.contactRequest.findFirst({
      where: { toPersonaId, status: 'declined', respondedAt: { gte: since }, from: { accountId: fromAccountId } },
      select: { id: true },
    });
    return Boolean(found);
  }

  countSentSince(fromAccountId: string, since: Date): Promise<number> {
    return this.db.contactRequest.count({ where: { createdAt: { gte: since }, from: { accountId: fromAccountId } } });
  }

  async setStatus(id: string, status: RequestStatus, at: Date): Promise<void> {
    await this.db.contactRequest.update({ where: { id }, data: { status, respondedAt: at } });
  }

  async expireDue(now: Date): Promise<number> {
    const { count } = await this.db.contactRequest.updateMany({
      where: { status: 'pending', expiresAt: { lte: now } },
      data: { status: 'expired', respondedAt: now },
    });
    return count;
  }
}
