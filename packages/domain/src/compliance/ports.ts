export interface PhoneChangeRecord {
  id: string;
  accountId: string;
  newPhone: string;
  effectiveAt: Date;
}

/** Account-level lifecycle operations (DPDP access/erasure, phone change). */
export interface AccountLifecycleRepository {
  /**
   * Rule 4, step 1: the account is switched off (its numbers read as unavailable) and every session
   * revoked. Nothing is erased yet: logging in within 30 days restores it.
   */
  requestDeletion(accountId: string, at: Date): Promise<void>;
  /** Accounts whose deletion was requested before `before` and not cancelled. */
  listDueErasures(before: Date, limit: number): Promise<string[]>;
  /**
   * Rule 4, step 2: retire every number (codes never reused), close chats, erase the user's message
   * content, cancel billing and anonymise the account row. Payment rows stay (8-year tax retention).
   * Returns the profile photo keys to destroy.
   */
  eraseAccount(accountId: string, at: Date): Promise<{ avatarKeys: string[] }>;
  /** Everything we hold about the user, as plain JSON (DPDP right of access). */
  /** `readablePersonaIds`: PIN-locked numbers not unlocked on this device are listed without content. */
  exportData(accountId: string, readablePersonaIds: ReadonlySet<string>): Promise<Record<string, unknown>>;
  isPhoneTaken(phone: string): Promise<boolean>;
  createPhoneChange(accountId: string, newPhone: string, verifiedAt: Date, effectiveAt: Date): Promise<PhoneChangeRecord>;
  pendingPhoneChange(accountId: string): Promise<PhoneChangeRecord | null>;
  cancelPhoneChanges(accountId: string, at: Date): Promise<void>;
  /** Applies due changes; returns the ones applied (skips numbers taken meanwhile). */
  applyDuePhoneChanges(now: Date): Promise<PhoneChangeRecord[]>;
}

export interface GrievanceTicket {
  id: string;
  complainantContact: string;
  subject: string;
  body: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'closed';
  ackDueAt: Date;
  resolveDueAt: Date;
  ackAt: Date | null;
  resolvedAt: Date | null;
  createdAt: Date;
}

export interface GrievanceRepository {
  create(input: { complainantContact: string; subject: string; body: string; ackDueAt: Date; resolveDueAt: Date }): Promise<{ id: string }>;
  list(status?: GrievanceTicket['status']): Promise<GrievanceTicket[]>;
  setStatus(id: string, status: GrievanceTicket['status'], at: Date): Promise<GrievanceTicket | null>;
  overdue(now: Date): Promise<{ ack: number; resolve: number }>;
}

/** IT Rules 2021: 24 h to acknowledge, 15 days to resolve. */
export const GRIEVANCE_SLA = { ackHours: 24, resolveDays: 15 } as const;
