import type { Prisma, PrismaClient } from '@hellogram/db';
import type { AuditRepository } from '@hellogram/domain';

export class PrismaAuditRepository implements AuditRepository {
  constructor(private readonly db: PrismaClient) {}

  async log(entry: Parameters<AuditRepository['log']>[0]): Promise<void> {
    await this.db.auditLog.create({
      data: {
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        targetType: entry.targetType ?? null,
        targetId: entry.targetId ?? null,
        meta: (entry.meta ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }
}
