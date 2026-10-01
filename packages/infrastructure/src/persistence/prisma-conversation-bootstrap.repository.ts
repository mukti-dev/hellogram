import type { ConversationBootstrapRepository, ConversationSeed } from '@hellogram/domain';
import { randomUUID } from 'node:crypto';
import type { Db } from './prisma-types.js';

/**
 * Rule 11: accepting a request creates the conversation and posts the intro
 * as its first message. Pairs are stored ordered (personaAId < personaBId).
 */
export class PrismaConversationBootstrapRepository implements ConversationBootstrapRepository {
  constructor(private readonly db: Db) {}

  async createFromRequest(seed: ConversationSeed): Promise<{ conversationId: string }> {
    const [personaAId, personaBId] = [seed.requesterPersonaId, seed.accepterPersonaId].sort() as [string, string];
    const existing = await this.db.conversation.findUnique({
      where: { personaAId_personaBId: { personaAId, personaBId } },
      select: { id: true },
    });

    const conversation =
      existing ??
      (await this.db.conversation.create({
        data: {
          personaAId,
          personaBId,
          retention: seed.retention,
          members: { create: [{ personaId: personaAId }, { personaId: personaBId }] },
        },
        select: { id: true },
      }));

    if (existing) {
      // Re-opened after an unblock: show it again on both sides.
      await this.db.conversationMember.updateMany({
        where: { conversationId: existing.id },
        data: { hiddenAt: null, counterpartMasked: false },
      });
    }

    await this.db.message.create({
      data: {
        conversationId: conversation.id,
        senderPersonaId: seed.requesterPersonaId,
        clientMessageId: `request:${seed.requestId}`,
        body: seed.introMessage,
        createdAt: seed.introAt,
      },
    });
    await this.db.conversation.update({ where: { id: conversation.id }, data: { lastMessageAt: new Date() } });
    return { conversationId: conversation.id };
  }
}

export const newId = () => randomUUID();
