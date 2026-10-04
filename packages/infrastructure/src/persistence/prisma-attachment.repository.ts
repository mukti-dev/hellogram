import type { Attachment, AttachmentRepository, NewAttachment } from '@hellogram/domain';
import type { Db } from './prisma-types.js';

export class PrismaAttachmentRepository implements AttachmentRepository {
  constructor(private readonly db: Db) {}

  create(attachment: NewAttachment): Promise<Attachment> {
    return this.db.attachment.create({ data: attachment });
  }

  findById(id: string): Promise<Attachment | null> {
    return this.db.attachment.findUnique({ where: { id } });
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
