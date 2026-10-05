import type { AttachmentKind } from '../chat/attachments.js';
export interface BlockRecord {
  id: string;
  blockerPersonaId: string;
  blockerPersonaCode: string;
  blockedPersonaId: string;
  blockedPersonaCode: string;
  blockedDisplayName: string;
  conversationId: string | null;
  createdAt: Date;
}

export interface BlockRepository {
  /** Idempotent per (blocker persona, blocked persona). */
  create(input: {
    blockerAccountId: string;
    blockedAccountId: string;
    blockerPersonaId: string;
    blockedPersonaId: string;
    conversationId: string | null;
    requestId: string | null;
  }): Promise<BlockRecord>;
  listByBlocker(blockerAccountId: string): Promise<BlockRecord[]>;
  findOwned(id: string, blockerAccountId: string): Promise<BlockRecord | null>;
  delete(id: string): Promise<void>;
}

export type ReportReason = 'harassment' | 'spam' | 'scam' | 'sexual_content' | 'threat' | 'other';

export interface EvidenceMessage {
  at: string;
  senderCode: string;
  senderDisplayName: string;
  type: 'text' | 'system' | 'intro';
  body: string | null;
  /** What was shared (details only — the file itself is not copied into the evidence). */
  attachment?: { kind: AttachmentKind; fileName: string; mimeType: string; sizeBytes: number } | null;
  deleted: boolean;
  /** Past the chat's retention (hidden from both sides, text kept for 30 days). */
  expired: boolean;
  suppressed: boolean;
}

export interface ReportRepository {
  create(input: {
    reporterPersonaId: string;
    reportedPersonaId: string;
    conversationId: string | null;
    requestId: string | null;
    reason: ReportReason;
    note: string | null;
    alsoBlocked: boolean;
    evidence: EvidenceMessage[];
  }): Promise<{ id: string }>;
  /** Last N messages of a conversation regardless of either side's clear/hide (evidence). */
  evidenceForConversation(conversationId: string, limit: number): Promise<EvidenceMessage[]>;
}

/** Scheduled clean-up jobs (§10). All return affected row counts. */
export interface MaintenanceRepository {
  /** Hides messages past their chat's retention (content stays until eraseDeletedContent). */
  expireContent(now: Date): Promise<number>;
  /** Erases text of messages deleted for everyone or expired before `before`; their files are swept next. */
  eraseDeletedContent(before: Date, now: Date): Promise<number>;
  purgeOldMetadata(before: Date): Promise<{ messages: number; calls: number }>;
  purgeClosedReportEvidence(before: Date): Promise<number>;
  expireRequests(now: Date): Promise<number>;
  cleanupAuth(now: Date): Promise<number>;
}
