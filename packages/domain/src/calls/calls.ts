import type { Persona } from '../personas/persona.js';

export type CallStatus = 'ringing' | 'answered' | 'missed' | 'declined' | 'ended' | 'failed';
export type CallEndReason = 'completed' | 'no_answer' | 'busy' | 'declined' | 'cancelled' | 'network_error' | 'suppressed';

export interface Call {
  id: string;
  conversationId: string;
  callerPersonaId: string;
  calleePersonaId: string;
  status: CallStatus;
  endReason: CallEndReason | null;
  suppressed: boolean;
  createdAt: Date;
  answeredAt: Date | null;
  endedAt: Date | null;
}

export interface CallWithParties extends Call {
  caller: Persona;
  callee: Persona;
}

/**
 * What each side sees in the call log (rule 31). Busy, DND, calls-off and
 * blocked calls all look like "no answer" to the caller.
 */
export type CallOutcome = 'answered' | 'no_answer' | 'declined' | 'missed' | 'cancelled';

export function outcomeFor(call: Call, viewerPersonaId: string): CallOutcome {
  const outgoing = call.callerPersonaId === viewerPersonaId;
  if (call.status === 'answered' || (call.status === 'ended' && call.answeredAt)) return 'answered';
  if (outgoing) {
    if (call.endReason === 'cancelled') return 'cancelled';
    return 'no_answer';
  }
  if (call.status === 'declined') return 'declined';
  return 'missed';
}

export const RING_SECONDS = 45;
export const TURN_TTL_SECONDS = 10 * 60;

export interface IceServer {
  urls: string[];
  username: string;
  credential: string;
}

export interface CallRepository {
  create(input: {
    conversationId: string;
    callerPersonaId: string;
    calleePersonaId: string;
    suppressed: boolean;
  }): Promise<Call>;
  findWithParties(id: string): Promise<CallWithParties | null>;
  /** Compare-and-set on status, so a timeout can't overwrite an answer (and vice versa). */
  transition(
    id: string,
    from: CallStatus[],
    to: { status: CallStatus; endReason?: CallEndReason | null; answeredAt?: Date; endedAt?: Date },
  ): Promise<boolean>;
  listForPersonas(personaIds: string[], cursor: string | null, limit: number): Promise<{ items: CallWithParties[]; nextCursor: string | null }>;
  /** Ringing calls older than `before` (missed-call sweeper). */
  staleRinging(before: Date): Promise<string[]>;
}

/** One active call per account (rule 31), in Redis with a TTL. */
export interface CallLock {
  acquire(accountId: string, callId: string, ttlSeconds: number): Promise<boolean>;
  release(accountId: string, callId: string): Promise<void>;
  holder(accountId: string): Promise<string | null>;
}

/** Short-lived TURN credentials bound to a call (coturn REST API / use-auth-secret). */
export interface TurnCredentialIssuer {
  issue(callId: string): IceServer[];
}

/** Fires the 45 s no-answer timeout. */
export interface CallTimeoutScheduler {
  schedule(callId: string, delayMs: number): void;
  cancel(callId: string): void;
}
