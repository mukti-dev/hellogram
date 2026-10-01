import type { PrismaClient } from '@hellogram/db';
import type { GrievanceRepository, GrievanceTicket } from '@hellogram/domain';

const select = {
  id: true, complainantContact: true, subject: true, body: true, status: true,
  ackDueAt: true, resolveDueAt: true, ackAt: true, resolvedAt: true, createdAt: true,
} as const;

export class PrismaGrievanceRepository implements GrievanceRepository {
  constructor(private readonly db: PrismaClient) {}

  create(input: { complainantContact: string; subject: string; body: string; ackDueAt: Date; resolveDueAt: Date }) {
    return this.db.grievanceTicket.create({ data: input, select: { id: true } });
  }

  list(status?: GrievanceTicket['status']): Promise<GrievanceTicket[]> {
    return this.db.grievanceTicket.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200, select });
  }

  async setStatus(id: string, status: GrievanceTicket['status'], at: Date): Promise<GrievanceTicket | null> {
    const current = await this.db.grievanceTicket.findUnique({ where: { id }, select });
    if (!current) return null;
    return this.db.grievanceTicket.update({
      where: { id },
      data: {
        status,
        ackAt: current.ackAt ?? (status !== 'open' ? at : null),
        resolvedAt: status === 'resolved' || status === 'closed' ? (current.resolvedAt ?? at) : current.resolvedAt,
      },
      select,
    });
  }

  async overdue(now: Date) {
    const [ack, resolve] = await Promise.all([
      this.db.grievanceTicket.count({ where: { ackAt: null, ackDueAt: { lt: now } } }),
      this.db.grievanceTicket.count({ where: { resolvedAt: null, resolveDueAt: { lt: now } } }),
    ]);
    return { ack, resolve };
  }
}
