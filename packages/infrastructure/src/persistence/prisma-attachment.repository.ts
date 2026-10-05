import { Prisma } from '@hellogram/db';
import type { Attachment, AttachmentRepository, NewAttachment } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

type Row = Omit<Attachment, 'waveform'> & { waveform: Prisma.JsonValue };
const toAttachment = (row: Row): Attachment => ({ ...row, waveform: Array.isArray(row.waveform) ? (row.waveform as number[]) : null });

export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: Db) {}

  async create({ waveform, ...attachment }: NewAttachment): Promise<Attachment> {
    const row = await this.db.attachment.create({ data: { ...attachment, waveform: waveform ?? Prisma.DbNull } });
    return toAttachment(row);
  }

  async findById(id: string): Promise<Attachment | null> {
    const row = await this.db.attachment.findUnique({ where: { id } });
    return row ? toAttachment(row) : null;
  }

  async delete(id: string): Promise<void> {
    await this.db.attachment.deleteMany({ where: { id } });
  }

  listDisposable(unsentBefore: Date, limit: number): Promise<Pick<Attachment, 'id' | 'storageKey'>[]> {
    return this.db.attachment.findMany({
      where: {
        OR: [
          // Never sent, or the message row is gone (FK set to NULL).
          { messageId: null, createdAt: { lt: unsentBefore } },
          // Deleted for everyone or expired files wait until the message's content is erased (30 days).
          { message: { contentPurgedAt: { not: null } } },
        ],
      },
      select: { id: true, storageKey: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }
}
