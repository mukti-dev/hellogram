import {
  DomainError,
  evaluateRequest,
  isPubliclyVisible,
  isReadable,
  type Actor,
  type Clock,
  type ContactRequest,
  type ConversationBootstrapRepository,
  type EventPublisher,
  type Page,
  type Persona,
  type PersonaRepository,
  type ReachRepository,
  type RequestRepository,
  type UnitOfWork,
} from '@hellogram/domain';
import { ErrorCode, LIMITS, normalizeNumberCode } from '@hellogram/shared';
import type { BlockService } from '../safety/block.service.js';

export const DEFAULT_INTRO = 'Hi, I’d like to connect.';
const DAY_MS = 24 * 60 * 60 * 1000;

export interface PublicCard {
  code: string;
  displayName: string;
  avatarKey: string | null;
  acceptsRequests: boolean;
}

export interface RequestTxRepos {
  requests: RequestRepository;
  conversations: ConversationBootstrapRepository;
}

export interface RequestDeps {
  requests: RequestRepository;
  personas: PersonaRepository;
  reach: ReachRepository;
  uow: UnitOfWork<RequestTxRepos>;
  blocks: BlockService;
  events: EventPublisher;
  clock: Clock;
}

/** Contact requests (rules 10–13) and the public number card. */
export class RequestService {
  constructor(private readonly deps: RequestDeps) {}

  /** Public card: display name, avatar, code only — never the owner (rule 13). */
  async publicCard(codeInput: string): Promise<PublicCard> {
    const code = normalizeNumberCode(codeInput);
    const persona = await this.deps.personas.findByCode(code);
    const account = persona ? await this.deps.reach.accountSnapshot(persona.accountId) : null;
    if (!persona || !isPubliclyVisible(persona, account, this.deps.clock.now())) {
      // Same answer for retired, banned and never-existed (anti-enumeration).
      throw new DomainError(ErrorCode.NOT_FOUND, 'This number isn’t available');
    }
    return {
      code: persona.code,
      displayName: persona.displayName,
      avatarKey: persona.avatarKey,
      acceptsRequests: persona.status === 'active' && persona.acceptRequests,
    };
  }

  async send(actor: Actor, input: { fromPersonaId: string; toCode: string; introMessage?: string | null | undefined }) {
    const from = await this.ownPersona(actor, input.fromPersonaId);
    const target = await this.deps.personas.findByCode(normalizeNumberCode(input.toCode));
    if (!target) throw new DomainError(ErrorCode.NOT_FOUND, 'This number isn’t available');

    const snapshot = await this.deps.reach.load(from.id, target.id);
    const now = this.deps.clock.now();
    if (!snapshot || !isPubliclyVisible(snapshot.targetPersona, snapshot.targetAccount, now)) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'This number isn’t available');
    }

    const decision = evaluateRequest(
      { now, ...snapshot },
      {
        pendingExists: await this.deps.requests.pendingExists(actor.accountId, target.id),
        declinedWithin7Days: await this.deps.requests.declinedSince(
          actor.accountId,
          target.id,
          new Date(now.getTime() - LIMITS.REQUEST_COOLDOWN_DAYS * DAY_MS),
        ),
        sentToday: await this.deps.requests.countSentSince(actor.accountId, new Date(now.getTime() - DAY_MS)),
      },
    );
    if (decision.kind === 'reject') throw new DomainError(decision.code, decision.message);

    const intro = input.introMessage?.trim() || DEFAULT_INTRO;
    if (intro.length > LIMITS.INTRO_MESSAGE_MAX) {
      throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Intro message must be 300 characters or fewer');
    }

    const request = await this.deps.requests.create({
      fromPersonaId: from.id,
      toPersonaId: target.id,
      introMessage: intro,
      suppressed: decision.kind === 'suppress',
      expiresAt: new Date(now.getTime() + LIMITS.REQUEST_EXPIRY_DAYS * DAY_MS),
    });

    if (decision.kind === 'allow') {
      await this.deps.events.publish({
        type: 'request.received',
        payload: { accountId: target.accountId, personaId: target.id, requestId: request.id, locked: target.hasPin },
        occurredAt: now,
      });
    }
    return request;
  }

  async listIncoming(
    actor: Actor,
    options: { status: 'pending' | 'blocked'; personaId?: string | undefined; cursor?: string | null | undefined; limit?: number },
  ): Promise<Page<ContactRequest>> {
    const ids = await this.readableIds(actor, options.personaId);
    return this.deps.requests.listIncoming(ids, options.status, options.cursor ?? null, options.limit ?? 30);
  }

  async listSent(actor: Actor, cursor?: string | null): Promise<Page<ContactRequest>> {
    return this.deps.requests.listSent(await this.readableIds(actor), cursor ?? null, 30);
  }

  async pendingCount(actor: Actor): Promise<number> {
    return this.deps.requests.countPendingIncoming(await this.readableIds(actor));
  }

  async accept(actor: Actor, requestId: string): Promise<{ conversationId: string }> {
    const request = await this.incoming(actor, requestId);
    const now = this.deps.clock.now();
    if (request.fromPersona.status === 'retired') {
      await this.deps.requests.setStatus(request.id, 'expired', now);
      throw new DomainError(ErrorCode.NUMBER_UNAVAILABLE, 'This number is no longer available');
    }
    const result = await this.deps.uow.run(async (repos) => {
      await repos.requests.setStatus(request.id, 'accepted', now);
      return repos.conversations.createFromRequest({
        requesterPersonaId: request.fromPersona.id,
        accepterPersonaId: request.toPersona.id,
        retention: request.toPersona.defaultRetention,
        introMessage: request.introMessage,
        introAt: request.createdAt,
        requestId: request.id,
      });
    });
    await this.deps.events.publish({
      type: 'request.updated',
      payload: {
        accountId: request.fromPersona.accountId,
        personaId: request.fromPersona.id,
        requestId: request.id,
        status: 'accepted',
        conversationId: result.conversationId,
      },
      occurredAt: now,
    });
    await this.deps.events.publish({
      type: 'conversation.created',
      payload: {
        conversationId: result.conversationId,
        personaIds: [request.fromPersona.id, request.toPersona.id],
      },
      occurredAt: now,
    });
    return result;
  }

  async decline(actor: Actor, requestId: string): Promise<void> {
    const request = await this.incoming(actor, requestId);
    const now = this.deps.clock.now();
    await this.deps.requests.setStatus(request.id, 'declined', now);
    await this.deps.events.publish({
      type: 'request.updated',
      payload: {
        accountId: request.fromPersona.accountId,
        personaId: request.fromPersona.id,
        requestId: request.id,
        status: 'declined',
      },
      occurredAt: now,
    });
  }

  /** Blocks the sender's whole account, silently (rules 14–15). */
  async block(actor: Actor, requestId: string): Promise<void> {
    const request = await this.incoming(actor, requestId);
    await this.deps.blocks.block({ blocker: request.toPersona, blocked: request.fromPersona, requestId: request.id });
    await this.deps.requests.setStatus(request.id, 'blocked', this.deps.clock.now());
  }

  expireDue(): Promise<number> {
    return this.deps.requests.expireDue(this.deps.clock.now());
  }

  private async incoming(actor: Actor, requestId: string): Promise<ContactRequest> {
    const request = await this.deps.requests.findById(requestId);
    if (
      !request ||
      request.suppressed ||
      request.toPersona.accountId !== actor.accountId ||
      request.status !== 'pending'
    ) {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Request not found');
    }
    const readable = await this.readableIds(actor);
    if (!readable.includes(request.toPersona.id)) {
      throw new DomainError(ErrorCode.PERSONA_LOCKED, 'Unlock this number first');
    }
    return request;
  }

  private async ownPersona(actor: Actor, personaId: string): Promise<Persona> {
    const persona = await this.deps.personas.findById(personaId);
    if (!persona || persona.accountId !== actor.accountId || persona.status === 'retired') {
      throw new DomainError(ErrorCode.NOT_FOUND, 'Number not found');
    }
    return persona;
  }

  private async readableIds(actor: Actor, onlyPersonaId?: string): Promise<string[]> {
    const personas = (await this.deps.personas.listByAccount(actor.accountId)).filter(
      (p) => !onlyPersonaId || p.id === onlyPersonaId,
    );
    return personas.filter((p) => isReadable(p, actor.unlockedPersonaIds)).map((p) => p.id);
  }
}
