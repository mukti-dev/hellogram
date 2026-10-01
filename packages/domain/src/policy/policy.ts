import { ErrorCode, LIMITS } from '@hellogram/shared';
import type { AccountStatus } from '../auth/entities.js';
import { isInDnd, type Persona } from '../personas/persona.js';

/**
 * The single "can X reach Y?" module (docs/ARCHITECTURE.md §6).
 * Pure functions over a snapshot the application layer loads; every module
 * (requests, chat, calls) goes through here so the rules can't drift.
 */
export interface AccountSnapshot {
  id: string;
  status: AccountStatus;
  suspendedUntil: Date | null;
}

export interface ReachContext {
  now: Date;
  actorAccount: AccountSnapshot;
  actorPersona: Persona;
  targetAccount: AccountSnapshot;
  targetPersona: Persona;
  /** Any block between the two accounts, in either direction (rule 14). */
  blocked: boolean;
}

export type Decision =
  | { kind: 'allow' }
  /** Silent block: looks successful to the actor, never reaches the target (rule 15). */
  | { kind: 'suppress' }
  /** Calls only: ring, then end as "no answer" — identical for busy / DND / calls off / blocked. */
  | { kind: 'ring_out' }
  | { kind: 'reject'; code: ErrorCode; message: string };

const reject = (code: ErrorCode, message: string): Decision => ({ kind: 'reject', code, message });
const ALLOW: Decision = { kind: 'allow' };
const SUPPRESS: Decision = { kind: 'suppress' };

export const isRestricted = (a: AccountSnapshot, now: Date) =>
  a.status === 'banned' ||
  a.status === 'deleted' ||
  (a.status === 'suspended' && (!a.suspendedUntil || a.suspendedUntil > now));

const UNAVAILABLE = reject(ErrorCode.NUMBER_UNAVAILABLE, 'This number is no longer available');

/** Steps 1–3 of §6.1, shared by every action. */
function baseChecks(ctx: ReachContext): Decision | null {
  if (isRestricted(ctx.actorAccount, ctx.now)) {
    return reject(ErrorCode.ACCOUNT_RESTRICTED, 'Your account is restricted');
  }
  if (ctx.actorPersona.status === 'retired') {
    return reject(ErrorCode.NUMBER_UNAVAILABLE, 'This number of yours has been deleted');
  }
  if (ctx.actorPersona.status === 'paused' && ctx.actorPersona.pauseReason !== 'user') {
    return reject(ErrorCode.NUMBER_PAUSED, 'This number is paused. Renew your plan to use it again.');
  }
  if (ctx.targetPersona.status === 'retired' || isRestricted(ctx.targetAccount, ctx.now)) {
    return UNAVAILABLE;
  }
  return null;
}

export interface RequestFacts {
  pendingExists: boolean;
  declinedWithin7Days: boolean;
  sentToday: number;
}

/** Rules 10, 12, 14: contact requests. */
export function evaluateRequest(ctx: ReachContext, facts: RequestFacts): Decision {
  if (ctx.actorAccount.id === ctx.targetAccount.id) {
    return reject(ErrorCode.OWN_NUMBER, 'That’s one of your own numbers');
  }
  const base = baseChecks(ctx);
  if (base) return base;
  if (facts.sentToday >= LIMITS.REQUESTS_PER_DAY) {
    return reject(ErrorCode.REQUEST_DAILY_CAP, 'You’ve reached today’s limit of 20 requests');
  }
  if (facts.pendingExists) {
    return reject(ErrorCode.REQUEST_ALREADY_PENDING, 'You already have a pending request to this number');
  }
  if (facts.declinedWithin7Days) {
    return reject(ErrorCode.REQUEST_COOLDOWN, 'You can request this number again in a few days');
  }
  if (ctx.targetPersona.status !== 'active' || !ctx.targetPersona.acceptRequests) {
    return reject(ErrorCode.NOT_ACCEPTING_REQUESTS, 'This number isn’t accepting new requests right now');
  }
  return ctx.blocked ? SUPPRESS : ALLOW;
}

export interface ConversationFacts {
  closed: boolean;
}

/** Rules 7, 9, 14, 17: sending a message in an existing conversation. */
export function evaluateMessage(ctx: ReachContext, facts: ConversationFacts): Decision {
  const base = baseChecks(ctx);
  if (base) return base;
  if (facts.closed) return UNAVAILABLE;
  if (ctx.targetPersona.status === 'paused' && ctx.targetPersona.pauseReason !== 'user') {
    // Billing grace: the other side can't receive. Silent, like a phone that's switched off.
    return SUPPRESS;
  }
  return ctx.blocked ? SUPPRESS : ALLOW;
}

export interface CallFacts extends ConversationFacts {
  calleeAccountBusy: boolean;
}

/** Rules 29 & 31: calls. Every "can't take it" case looks like no answer. */
export function evaluateCall(ctx: ReachContext, facts: CallFacts): Decision {
  const message = evaluateMessage(ctx, facts);
  if (message.kind === 'reject') return message;
  if (message.kind === 'suppress') return { kind: 'ring_out' };
  if (!ctx.targetPersona.allowCalls || isInDnd(ctx.targetPersona, ctx.now) || facts.calleeAccountBusy) {
    return { kind: 'ring_out' };
  }
  return ALLOW;
}

/** Public number card (rule 20 / §8): same generic 404 for retired, banned or never-existed. */
export function isPubliclyVisible(persona: Persona | null, account: AccountSnapshot | null, now: Date): boolean {
  return Boolean(persona && account && persona.status !== 'retired' && !isRestricted(account, now));
}
