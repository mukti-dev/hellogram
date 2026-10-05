import {
  DomainError,
  assertCanDeleteForEveryone,
  evaluateMessage,
  isClosed,
  isReadable,
  mediaAllowed,
  normalizeCaption,
  normalizeMessageBody,
  normalizeNickname,
  type Actor,
  type Clock,
  type ConversationRepository,
  type ConversationView,
  type EventPublisher,
  type InboxRow,
  type Message,
  type Page,
  type Persona,
  type PersonaRepository,
  type RateLimiter,
  type ReachRepository,
  type VaultState,
} from '@hellogram/domain';
import { ErrorCode, type GifDto, type Retention } from '@hellogram/shared';

export interface ChatDeps {
  conversations: ConversationRepository;
  personas: PersonaRepository;
  reach: ReachRepository;
  events: EventPublisher;
  clock: Clock;
  limiter: RateLimiter;
}

/** Spec §11: 30 messages per minute per persona. */
const MESSAGES_PER_MINUTE = 30;

export interface InboxQuery {
  /** Vault folder; default the normal inbox. 'hidden' lists the spaces this device opened. */
  folder?: VaultState | 'inbox' | undefined;
  personaId?: string | undefined;
  label?: string | undefined;
  unreadOnly?: boolean | undefined;
  query?: string | undefined;
  cursor?: string | null | undefined;
}

export interface InboxResult extends Page<InboxRow> {
  /** Locked numbers that have chats: shown as one row each, with no names or previews (rule 25). */
  locked: Persona[];
}

/** One-to-one chat (rules 17–23). Everything goes through the policy module. */
export class ChatService {
  constructor(private readonly deps: ChatDeps) {}

  async inbox(actor: Actor, query: InboxQuery = {}): Promise<InboxResult> {
    const mine = (await this.deps.personas.listByAccount(actor.accountId)).filter(
      (p) => !query.personaId || p.id === query.personaId,
    );
    const readable = mine.filter((p) => isReadable(p, actor.unlockedPersonaIds));
    const folder = query.folder ?? 'inbox';
    const spaceIds = [...(actor.vault?.spaces ?? [])];
    if (folder === 'hidden' && spaceIds.length === 0) return { items: [], nextCursor: null, locked: [] };
    const page = await this.deps.conversations.listInbox({
      personaIds: readable.map((p) => p.id),
      folders: [folder],
      spaceIds,
      label: query.label,
      unreadOnly: query.unreadOnly,
      query: query.query,
      cursor: query.cursor,
      limit: 30,
    });
    // Locked chats show who they're with, but no preview until this device opens them.
    const items = page.items.map((row) =>
      row.me.vault === 'locked' && !actor.vault?.chats.has(row.conversation.id) ? { ...row, lastMessage: null } : row,
    );
    const locked =
      folder !== 'inbox' || query.cursor || query.query ? [] : mine.filter((p) => !isReadable(p, actor.unlockedPersonaIds));
    return { items, nextCursor: page.nextCursor, locked };
  }

  async unreadCount(actor: Actor): Promise<number> {
    const readable = (await this.deps.personas.listByAccount(actor.accountId)).filter((p) =>
      isReadable(p, actor.unlockedPersonaIds),
    );
    // Archived and hidden chats don't count.
    return this.deps.conversations.countUnreadConversations(readable.map((p) => p.id), ['inbox', 'locked']);
  }

  /** The conversation from the actor's side. Enforces membership and PIN lock. */
  async view(actor: Actor, conversationId: string): Promise<ConversationView> {
    const mine = await this.deps.personas.listByAccount(actor.accountId);
    const view = await this.deps.conversations.findViewForAccount(
      conversationId,
      mine.map((p) => p.id),
    );
    if (!view || view.me.hiddenAt) throw new DomainError(ErrorCode.NOT_FOUND, 'Chat not found');
    if (!isReadable(view.myPersona, actor.unlockedPersonaIds)) {
      throw new DomainError(ErrorCode.PERSONA_LOCKED, 'Unlock this number to see its chats', {
        personaId: view.myPersona.id,
      });
    }
    // Hidden chats don't exist for a device that hasn't opened their space.
    if (view.me.vault === 'hidden' && !(view.me.vaultSpaceId && actor.vault?.spaces.has(view.me.vaultSpaceId))) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Chat not found');
    }
    if (view.me.vault === 'locked' && !actor.vault?.chats.has(conversationId)) {
      throw new DomainError(ErrorCode.CHAT_LOCKED, 'Enter your chat lock PIN', { conversationId });
    }
    return view;
  }

  async messages(actor: Actor, conversationId: string, cursor?: string | null): Promise<Page<Message>> {
    const view = await this.view(actor, conversationId);
    return this.deps.conversations.listMessages(conversationId, view.myPersona.id, cursor ?? null, 50);
  }

  async send(
    actor: Actor,
    conversationId: string,
    input: { clientMessageId: string; body?: string | undefined; attachmentId?: string | undefined; gif?: GifDto | undefined },
  ): Promise<Message> {
    const view = await this.view(actor, conversationId);
    // With a file or a GIF, the text is an optional caption.
    const body = input.attachmentId || input.gif ? normalizeCaption(input.body) : normalizeMessageBody(input.body ?? '');
    if (!(await this.deps.limiter.hit(`msg:${view.myPersona.id}`, MESSAGES_PER_MINUTE, 60))) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'You’re sending messages too fast. Wait a moment.');
    }
    const snapshot = await this.deps.reach.load(view.myPersona.id, view.otherPersona.id);
    if (!snapshot) throw new DomainError(ErrorCode.NOT_FOUND, 'Chat not found');
    const now = this.deps.clock.now();

    const decision = evaluateMessage({ now, ...snapshot }, { closed: isClosed(view) });
    if (decision.kind === 'reject') throw new DomainError(decision.code, decision.message);

    if ((input.attachmentId || input.gif) && !mediaAllowed(view)) throw mediaOff();
    const result = await this.deps.conversations.insertMessage({
      conversationId,
      senderPersonaId: view.myPersona.id,
      clientMessageId: input.clientMessageId,
      body,
      type: 'text',
      suppressed: decision.kind === 'suppress',
      attachmentId: input.attachmentId ?? null,
      gif: input.gif ?? null,
    });
    if ('attachmentRejected' in result) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'This file is no longer available. Attach it again.');
    }
    if (result.created) await this.publishNew(view, result.message);
    return result.message;
  }

  /** Recipient device confirms receipt (✓✓). Works across all the actor's numbers. */
  async ackDelivered(actor: Actor, messageIds: string[]): Promise<void> {
    const mine = await this.deps.personas.listByAccount(actor.accountId);
    const now = this.deps.clock.now();
    for (const persona of mine) {
      const groups = await this.deps.conversations.markDelivered(persona.id, messageIds, now);
      for (const group of groups) {
        await this.deps.events.publish({ type: 'message.delivered', payload: group, occurredAt: now });
      }
    }
  }

  /** Read ticks are only sent if the *reader* has read receipts on (rule 17). */
  async markRead(actor: Actor, conversationId: string, upToMessageId: string): Promise<void> {
    const view = await this.view(actor, conversationId);
    const now = this.deps.clock.now();
    const stamp = view.myPersona.readReceipts;
    const { changed } = await this.deps.conversations.markRead(conversationId, view.myPersona.id, upToMessageId, stamp, now);
    if (!changed) return;
    await this.deps.events.publish({
      type: 'message.read',
      payload: {
        conversationId,
        readerPersonaId: view.myPersona.id,
        senderPersonaId: view.otherPersona.id,
        upToMessageId,
        receipts: stamp,
        readerAccountId: actor.accountId,
      },
      occurredAt: now,
    });
  }

  async deleteMessage(actor: Actor, messageId: string, scope: 'me' | 'everyone'): Promise<void> {
    const message = await this.deps.conversations.findMessage(messageId);
    if (!message) throw new DomainError(ErrorCode.NOT_FOUND, 'Message not found');
    const view = await this.view(actor, message.conversationId);
    const visible = !message.suppressed || message.senderPersonaId === view.myPersona.id;
    if (!visible) throw new DomainError(ErrorCode.NOT_FOUND, 'Message not found');
    const now = this.deps.clock.now();

    if (scope === 'me') {
      await this.deps.conversations.hideMessage(message.id, view.myPersona.id);
      await this.deps.events.publish({
        type: 'message.deleted',
        payload: { conversationId: message.conversationId, messageId, scope, personaIds: [view.myPersona.id] },
        occurredAt: now,
      });
      return;
    }
    assertCanDeleteForEveryone(message);
    if (message.deletedForEveryoneAt) return;
    // Soft delete: gone for both sides now; text and file are erased by the worker after 30 days.
    await this.deps.conversations.deleteForEveryone(message.id, now);
    await this.deps.events.publish({
      type: 'message.deleted',
      payload: {
        conversationId: message.conversationId,
        messageId,
        scope,
        // A suppressed message was never seen by the other side — only update the sender.
        personaIds: message.suppressed ? [view.myPersona.id] : [view.myPersona.id, view.otherPersona.id],
      },
      occurredAt: now,
    });
  }

  async updateSettings(
    actor: Actor,
    conversationId: string,
    patch: { nickname?: string | null | undefined; mutedUntil?: Date | null | undefined; retention?: Retention | undefined },
  ): Promise<ConversationView> {
    const view = await this.view(actor, conversationId);
    const now = this.deps.clock.now();
    const memberPatch: { nickname?: string | null; mutedUntil?: Date | null } = {};
    if (patch.nickname !== undefined) memberPatch.nickname = normalizeNickname(patch.nickname);
    if (patch.mutedUntil !== undefined) memberPatch.mutedUntil = patch.mutedUntil;
    if (Object.keys(memberPatch).length > 0) {
      await this.deps.conversations.updateMember(conversationId, view.myPersona.id, memberPatch);
      // Nickname and mute are private: only this account's devices hear about it.
      await this.deps.events.publish({
        type: 'conversation.private_updated',
        payload: { accountId: actor.accountId, conversationId },
        occurredAt: now,
      });
    }

    if (patch.retention !== undefined && patch.retention !== view.conversation.retention) {
      if (isClosed(view)) throw new DomainError(ErrorCode.CONVERSATION_CLOSED, 'This chat is closed');
      await this.changeRetention(view, patch.retention, now);
    }
    return this.view(actor, conversationId);
  }

  /** Rule 21: either member can change it; both get a system message. */
  private async changeRetention(view: ConversationView, retention: Retention, now: Date): Promise<void> {
    await this.deps.conversations.setRetention(view.conversation.id, retention, view.myPersona.id, now);
    const result = await this.deps.conversations.insertMessage({
      conversationId: view.conversation.id,
      senderPersonaId: view.myPersona.id,
      clientMessageId: `retention:${now.getTime()}`,
      body: null,
      type: 'system',
      systemPayload: { kind: 'retention_changed', byPersonaId: view.myPersona.id, value: retention },
      // Deliberately never suppressed: a shared setting that silently changed would reveal a block.
      suppressed: false,
    });
    if ('attachmentRejected' in result) return;
    await this.publishNew(view, result.message);
    await this.deps.events.publish({
      type: 'conversation.updated',
      payload: {
        conversationId: view.conversation.id,
        personaIds: [view.myPersona.id, view.otherPersona.id],
      },
      occurredAt: now,
    });
  }

  /** Rule 23: clears history for this side only. */
  async clear(actor: Actor, conversationId: string): Promise<void> {
    const view = await this.view(actor, conversationId);
    const now = this.deps.clock.now();
    await this.deps.conversations.updateMember(conversationId, view.myPersona.id, { clearedBefore: now });
    await this.deps.events.publish({
      type: 'conversation.private_updated',
      payload: { accountId: actor.accountId, conversationId },
      occurredAt: now,
    });
  }

  /** Rule 18: typing goes to the other side only if a message would be delivered. */
  async typingTarget(actor: Actor, conversationId: string): Promise<{ personaId: string; fromPersonaId: string } | null> {
    const view = await this.view(actor, conversationId).catch(() => null);
    if (!view || isClosed(view)) return null;
    const snapshot = await this.deps.reach.load(view.myPersona.id, view.otherPersona.id);
    if (!snapshot) return null;
    const decision = evaluateMessage({ now: this.deps.clock.now(), ...snapshot }, { closed: false });
    // Locked numbers get no typing events (rule 27: content-free notifications only).
    if (view.otherPersona.hasPin) return null;
    return decision.kind === 'allow' ? { personaId: view.otherPersona.id, fromPersonaId: view.myPersona.id } : null;
  }

  private publishNew(view: ConversationView, message: Message) {
    return this.deps.events.publish({
      type: 'message.created',
      payload: {
        message,
        conversationId: view.conversation.id,
        senderPersonaId: view.myPersona.id,
        senderAccountId: view.myPersona.accountId,
        senderLocked: view.myPersona.hasPin,
        recipientPersonaId: view.otherPersona.id,
        recipientLocked: view.otherPersona.hasPin,
      },
      occurredAt: this.deps.clock.now(),
    });
  }

  /** True when this side sees the other person as "Unknown" (they blocked us). */
  async isCounterpartMasked(conversationId: string, personaId: string): Promise<boolean> {
    return Boolean((await this.deps.conversations.findView(conversationId, personaId))?.me.counterpartMasked);
  }

  /** Block effects registered with BlockService (§6.3). */
  blockEffects() {
    return {
      applyBlock: (conversationId: string, blockerPersonaId: string, blockedPersonaId: string) =>
        this.deps.conversations.applyBlock(conversationId, blockerPersonaId, blockedPersonaId, this.deps.clock.now()),
      removeBlock: (conversationId: string) => this.deps.conversations.removeBlock(conversationId),
    };
  }
}

export const mediaOff = () =>
  new DomainError(ErrorCode.MEDIA_NOT_ALLOWED, 'Photos and files are turned off in this chat.');
