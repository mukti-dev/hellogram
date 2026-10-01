import type { EvidenceMessage, ReportReason, ReportRepository } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaReportRepository implements ReportRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    reporterPersonaId: string;
    reportedPersonaId: string;
    conversationId: string | null;
    requestId: string | null;
    reason: ReportReason;
    note: string | null;
    alsoBlocked: boolean;
    evidence: EvidenceMessage[];
  }): Promise<{ id: string }> {
    const { evidence, ...report } = input;
    return this.db.report.create({
      data: { ...report, evidence: { create: { snapshot: evidence as unknown as object } } },
      select: { id: true },
    });
  }

  async evidenceForConversation(conversationId: string, limit: number): Promise<EvidenceMessage[]> {
    const rows = await this.db.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
      select: {
        createdAt: true,
        type: true,
        body: true,
        suppressed: true,
        deletedForEveryoneAt: true,
        clientMessageId: true,
        attachment: { select: { kind: true, fileName: true, mimeType: true, sizeBytes: true } },
        sender: { select: { code: true, displayName: true } },
      },
    });
    return rows.reverse().map((m) => ({
      at: m.createdAt.toISOString(),
      senderCode: m.sender.code,
      senderDisplayName: m.sender.displayName,
      type: m.clientMessageId.startsWith('request:') ? 'intro' : m.type,
      body: m.body,
      attachment: m.attachment,
      deleted: Boolean(m.deletedForEveryoneAt),
      suppressed: m.suppressed,
    }));
  }
}
