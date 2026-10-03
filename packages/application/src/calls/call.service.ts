import {
  DomainError,
  RING_SECONDS,
  evaluateCall,
  isClosed,
  isReadable,
  outcomeFor,
  type Actor,
  type Call,
  type CallLock,
  type CallOutcome,
  type CallRepository,
  type CallTimeoutScheduler,
  type CallWithParties,
  type Clock,
  type CryptoService,
  type EventPublisher,
  type IceServer,
  type Persona,
  type PersonaRepository,
  type RateLimiter,
  type ReachRepository,
  type TurnCredentialIssuer,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { ChatService } from '../chat/chat.service.js';

export interface CallDeps {
  calls: CallRepository;
  personas: PersonaRepository;
  reach: ReachRepository;
  chat: ChatService;
  lock: CallLock;
  limiter?: RateLimiter;
  turn: TurnCredentialIssuer;
  events: EventPublisher;
  clock: Clock;
  /** Signs the Decline key carried by the incoming-call notification (absent in the worker). */
  crypto?: CryptoService;
  /** Set after construction (the scheduler calls back into this service). */
  timeouts?: CallTimeoutScheduler;
}

export interface CallStart {
  callId: string;
  iceServers: IceServer[];
  iceTransportPolicy: 'relay';
  ringSeconds: number;
}

export interface CallLogEntry {
  call: CallWithParties;
  me: Persona;
  other: Persona;
  direction: 'incoming' | 'outgoing';
  outcome: CallOutcome;
  /** Same masking as the chat: "Unknown" when the other person blocked us. */
  masked: boolean;
}

/** In-call locks outlive ringing but not a stuck client. */
const LOCK_SECONDS = 4 * 60 * 60;

/** Voice calls (rules 29–32). Media is WebRTC relayed through TURN only. */
export class CallService {
  constructor(private readonly deps: CallDeps) {}

  setTimeouts(timeouts: CallTimeoutScheduler) {
    this.deps.timeouts = timeouts;
  }

  async start(actor: Actor, conversationId: string): Promise<CallStart> {
    const view = await this.deps.chat.view(actor, conversationId);
    const snapshot = await this.deps.reach.load(view.myPersona.id, view.otherPersona.id);
    if (!snapshot) throw new DomainError(ErrorCode.NOT_FOUND, 'Chat not found');

    if (this.deps.limiter && !(await this.deps.limiter.hit(`call:${view.myPersona.id}`, 10, 600))) {
      throw new DomainError(ErrorCode.RATE_LIMITED, 'Too many calls. Try again in a few minutes.');
    }
    if (await this.deps.lock.holder(actor.accountId)) {
      throw new DomainError(ErrorCode.CALL_NOT_ALLOWED, 'Finish your current call first');
    }
    const calleeBusy = Boolean(await this.deps.lock.holder(view.otherPersona.accountId));
    const decision = evaluateCall(
      { now: this.deps.clock.now(), ...snapshot },
      { closed: isClosed(view), calleeAccountBusy: calleeBusy },
    );
    if (decision.kind === 'reject') throw new DomainError(decision.code, decision.message);

    const ringOut = decision.kind === 'ring_out';
    const call = await this.deps.calls.create({
      conversationId,
      callerPersonaId: view.myPersona.id,
      calleePersonaId: view.otherPersona.id,
      suppressed: ringOut,
    });
    await this.deps.lock.acquire(actor.accountId, call.id, LOCK_SECONDS);
    this.deps.timeouts?.schedule(call.id, RING_SECONDS * 1000);

    if (!ringOut) {
      await this.deps.events.publish({
        type: 'call.incoming',
        payload: {
          callId: call.id,
          conversationId,
          calleePersonaId: view.otherPersona.id,
          calleeLocked: view.otherPersona.hasPin,
          caller: view.myPersona,
          callee: view.otherPersona,
          declineToken: this.declineToken(call.id),
        },
        occurredAt: this.deps.clock.now(),
      });
    }
    return { callId: call.id, iceServers: this.deps.turn.issue(call.id), iceTransportPolicy: 'relay', ringSeconds: RING_SECONDS };
  }

  async accept(actor: Actor, callId: string): Promise<{ iceServers: IceServer[]; iceTransportPolicy: 'relay' }> {
    const call = await this.party(actor, callId, 'callee');
    if (call.suppressed) throw new DomainError(ErrorCode.NOT_FOUND, 'Call not found');
    if (!(await this.deps.lock.acquire(actor.accountId, call.id, LOCK_SECONDS))) {
      throw new DomainError(ErrorCode.CALL_NOT_ALLOWED, 'You’re already on another call');
    }
    const now = this.deps.clock.now();
    const ok = await this.deps.calls.transition(call.id, ['ringing'], { status: 'answered', answeredAt: now });
    if (!ok) {
      await this.deps.lock.release(actor.accountId, call.id);
      throw new DomainError(ErrorCode.CALL_NOT_ALLOWED, 'This call has ended');
    }
    this.deps.timeouts?.cancel(call.id);
    await this.publish('call.accepted', call, { acceptedBySessionId: actor.sessionId });
    return { iceServers: this.deps.turn.issue(call.id), iceTransportPolicy: 'relay' };
  }

  /** Callee declines. The caller just sees "no answer" (rule 31). */
  async decline(actor: Actor, callId: string): Promise<void> {
    const call = await this.party(actor, callId, 'callee');
    if (await this.deps.calls.transition(call.id, ['ringing'], { status: 'declined', endReason: 'declined', endedAt: this.deps.clock.now() })) {
      await this.finish(call, 'no_answer', false);
    }
  }

  /**
   * Decline from the notification's button, where there is no session: the key in the push
   * proves it came from the callee's notification, and it can only refuse this ringing call.
   * Wrong keys and unknown calls are ignored silently (no oracle).
   */
  async declineFromNotification(callId: string, token: string): Promise<void> {
    const expected = this.declineToken(callId);
    if (!expected || !this.deps.crypto?.safeEqual(expected, token)) return;
    const call = await this.deps.calls.findWithParties(callId);
    if (!call) return;
    if (await this.deps.calls.transition(call.id, ['ringing'], { status: 'declined', endReason: 'declined', endedAt: this.deps.clock.now() })) {
      await this.finish(call, 'no_answer', false);
    }
  }

  /** A call still ringing for me, for a device opened from the notification. */
  async ringing(actor: Actor, callId: string): Promise<{ call: CallWithParties; calleeLocked: boolean }> {
    const call = await this.party(actor, callId, 'callee');
    if (call.status !== 'ringing' || call.suppressed) throw new DomainError(ErrorCode.NOT_FOUND, 'This call has ended');
    return { call, calleeLocked: call.callee.hasPin };
  }

  /** Either side hangs up. Caller hanging up while ringing = cancelled (callee sees missed). */
  async end(actor: Actor, callId: string): Promise<void> {
    const call = await this.party(actor, callId, 'either');
    const now = this.deps.clock.now();
    if (await this.deps.calls.transition(call.id, ['answered'], { status: 'ended', endReason: 'completed', endedAt: now })) {
      return this.finish(call, 'completed', false);
    }
    if (await this.deps.calls.transition(call.id, ['ringing'], { status: 'missed', endReason: 'cancelled', endedAt: now })) {
      return this.finish(call, 'cancelled', true);
    }
  }

  /** 45 s without an answer (or a suppressed / busy call) → missed. */
  async timeout(callId: string): Promise<void> {
    const call = await this.deps.calls.findWithParties(callId);
    if (!call) return;
    const reason = call.suppressed ? 'suppressed' : 'no_answer';
    if (await this.deps.calls.transition(call.id, ['ringing'], { status: 'missed', endReason: reason, endedAt: this.deps.clock.now() })) {
      await this.finish(call, 'no_answer', !call.suppressed);
    }
  }

  /** Relays WebRTC signalling to the other party. Returns the persona to send to, or null. */
  async signalTarget(actor: Actor, callId: string): Promise<{ toPersonaId: string } | null> {
    const call = await this.party(actor, callId, 'either').catch(() => null);
    if (!call || call.suppressed || (call.status !== 'ringing' && call.status !== 'answered')) return null;
    const mine = await this.myPersonaIds(actor);
    return { toPersonaId: mine.includes(call.callerPersonaId) ? call.calleePersonaId : call.callerPersonaId };
  }

  async log(actor: Actor, options: { personaId?: string | undefined; cursor?: string | null | undefined }) {
    const personas = (await this.deps.personas.listByAccount(actor.accountId)).filter(
      (p) => (!options.personaId || p.id === options.personaId) && isReadable(p, actor.unlockedPersonaIds),
    );
    const ids = personas.map((p) => p.id);
    const page = await this.deps.calls.listForPersonas(ids, options.cursor ?? null, 50);
    const items: CallLogEntry[] = await Promise.all(
      page.items.map(async (call) => {
        const outgoing = ids.includes(call.callerPersonaId);
        const me = outgoing ? call.caller : call.callee;
        return {
          call,
          me,
          other: outgoing ? call.callee : call.caller,
          direction: outgoing ? ('outgoing' as const) : ('incoming' as const),
          outcome: outcomeFor(call, me.id),
          masked: await this.deps.chat.isCounterpartMasked(call.conversationId, me.id),
        };
      }),
    );
    return { items, nextCursor: page.nextCursor };
  }

  async sweepStaleRinging(): Promise<number> {
    const stale = await this.deps.calls.staleRinging(new Date(this.deps.clock.now().getTime() - (RING_SECONDS + 15) * 1000));
    for (const id of stale) await this.timeout(id);
    return stale.length;
  }

  /** `missed`: the callee never picked up or declined (their notification becomes "Missed call"). */
  private async finish(call: Call, reason: 'completed' | 'no_answer' | 'cancelled', missed: boolean) {
    this.deps.timeouts?.cancel(call.id);
    const [caller, callee] = await Promise.all([
      this.deps.personas.findById(call.callerPersonaId),
      this.deps.personas.findById(call.calleePersonaId),
    ]);
    if (caller) await this.deps.lock.release(caller.accountId, call.id);
    if (callee) await this.deps.lock.release(callee.accountId, call.id);
    await this.publish('call.ended', call, { reason, missed });
  }

  private declineToken(callId: string): string | undefined {
    return this.deps.crypto?.hmac('call', `decline:${callId}`);
  }

  private publish(type: 'call.accepted' | 'call.ended', call: Call, extra: Record<string, unknown>) {
    return this.deps.events.publish({
      type,
      payload: {
        callId: call.id,
        callerPersonaId: call.callerPersonaId,
        calleePersonaId: call.calleePersonaId,
        suppressed: call.suppressed,
        ...extra,
      },
      occurredAt: this.deps.clock.now(),
    });
  }

  private async myPersonaIds(actor: Actor) {
    return (await this.deps.personas.listByAccount(actor.accountId)).map((p) => p.id);
  }

  private async party(actor: Actor, callId: string, role: 'caller' | 'callee' | 'either'): Promise<CallWithParties> {
    const call = await this.deps.calls.findWithParties(callId);
    const mine = await this.myPersonaIds(actor);
    const isCaller = Boolean(call && mine.includes(call.callerPersonaId));
    const isCallee = Boolean(call && mine.includes(call.calleePersonaId));
    const allowed = role === 'caller' ? isCaller : role === 'callee' ? isCallee : isCaller || isCallee;
    if (!call || !allowed) throw new DomainError(ErrorCode.NOT_FOUND, 'Call not found');
    return call;
  }
}
