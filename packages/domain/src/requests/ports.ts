import type { Retention } from '@hellogram/shared';
import type { Persona } from '../personas/persona.js';
import type { AccountSnapshot } from '../policy/policy.js';

export type RequestStatus = 'pending' | 'accepted' | 'declined' | 'blocked' | 'expired';

export interface ContactRequest {
  id: string;
  fromPersona: Persona;
  toPersona: Persona;
  introMessage: string;
  status: RequestStatus;
  suppressed: boolean;
  createdAt: Date;
  respondedAt: Date | null;
  expiresAt: Date;
}

export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

/** Loads everything the policy module needs about an actor/target pair. */
export interface ReachSnapshot {
  actorAccount: AccountSnapshot;
  actorPersona: Persona;
  targetAccount: AccountSnapshot;
  targetPersona: Persona;
  blocked: boolean;
}

export interface ReachRepository {
  load(actorPersonaId: string, targetPersonaId: string): Promise<ReachSnapshot | null>;
  accountSnapshot(accountId: string): Promise<AccountSnapshot | null>;
  /** Any block between the two accounts in either direction. */
  isBlockedBetween(accountA: string, accountB: string): Promise<boolean>;
}

export interface RequestRepository {
  create(input: {
    fromPersonaId: string;
    toPersonaId: string;
    introMessage: string;
    suppressed: boolean;
    expiresAt: Date;
  }): Promise<ContactRequest>;
  findById(id: string): Promise<ContactRequest | null>;
  listIncoming(personaIds: string[], status: 'pending' | 'blocked', cursor: string | null, limit: number): Promise<Page<ContactRequest>>;
  listSent(personaIds: string[], cursor: string | null, limit: number): Promise<Page<ContactRequest>>;
  countPendingIncoming(personaIds: string[]): Promise<number>;
  pendingExists(fromAccountId: string, toPersonaId: string): Promise<boolean>;
  declinedSince(fromAccountId: string, toPersonaId: string, since: Date): Promise<boolean>;
  countSentSince(fromAccountId: string, since: Date): Promise<number>;
  setStatus(id: string, status: RequestStatus, at: Date): Promise<void>;
  expireDue(now: Date): Promise<number>;
}

export interface ConversationSeed {
  requesterPersonaId: string;
  accepterPersonaId: string;
  retention: Retention;
  introMessage: string;
  introAt: Date;
  requestId: string;
}

export interface ConversationBootstrapRepository {
  /** Creates (or re-opens) the conversation for a pair and posts the intro as the first message. */
  createFromRequest(seed: ConversationSeed): Promise<{ conversationId: string }>;
}
