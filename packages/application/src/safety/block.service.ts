import {
  DomainError,
  type Actor,
  type BlockRecord,
  type BlockRepository,
  type Clock,
  type EventPublisher,
  type Persona,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

/** Hook the chat module registers to hide/mask a conversation when it's blocked (Phase 6). */
export interface ConversationBlockEffects {
  applyBlock(conversationId: string, blockerPersonaId: string, blockedPersonaId: string): Promise<void>;
  removeBlock(conversationId: string): Promise<void>;
}

/**
 * Rules 14–16: account-level, silent blocks. Nothing here is ever reported to the
 * blocked side; the policy module turns the Block row into silent suppression.
 */
export class BlockService {
  constructor(
    private readonly deps: {
      blocks: BlockRepository;
      clock: Clock;
      events: EventPublisher;
      conversations?: ConversationBlockEffects;
    },
  ) {}

  async block(input: {
    blocker: Persona;
    blocked: Persona;
    conversationId?: string | null;
    requestId?: string | null;
  }): Promise<BlockRecord> {
    if (input.blocker.accountId === input.blocked.accountId) {
      throw new DomainError(ErrorCode.OWN_NUMBER, 'You can’t block your own number');
    }
    const record = await this.deps.blocks.create({
      blockerAccountId: input.blocker.accountId,
      blockedAccountId: input.blocked.accountId,
      blockerPersonaId: input.blocker.id,
      blockedPersonaId: input.blocked.id,
      conversationId: input.conversationId ?? null,
      requestId: input.requestId ?? null,
    });
    if (input.conversationId && this.deps.conversations) {
      await this.deps.conversations.applyBlock(input.conversationId, input.blocker.id, input.blocked.id);
    }
    await this.deps.events.publish({
      type: 'block.changed',
      payload: { accountId: input.blocker.accountId },
      occurredAt: this.deps.clock.now(),
    });
    return record;
  }

  list(actor: Actor): Promise<BlockRecord[]> {
    return this.deps.blocks.listByBlocker(actor.accountId);
  }

  async unblock(actor: Actor, blockId: string): Promise<void> {
    const record = await this.deps.blocks.findOwned(blockId, actor.accountId);
    if (!record) throw new DomainError(ErrorCode.NOT_FOUND, 'Block not found');
    await this.deps.blocks.delete(record.id);
    if (record.conversationId && this.deps.conversations) {
      await this.deps.conversations.removeBlock(record.conversationId);
    }
    await this.deps.events.publish({
      type: 'block.changed',
      payload: { accountId: actor.accountId },
      occurredAt: this.deps.clock.now(),
    });
  }
}
