import {
  DomainError,
  type Actor,
  type Clock,
  type EventPublisher,
  type ReportReason,
  type ReportRepository,
  type RequestRepository,
} from '@hellogram/domain';
import { ErrorCode, LIMITS } from '@hellogram/shared';
import type { ChatService } from '../chat/chat.service.js';
import type { BlockService } from './block.service.js';

/** Blocking from a chat (rule 16) and reporting with evidence (rules 33–34). */
export class SafetyService {
  constructor(
    private readonly deps: {
      chat: ChatService;
      blocks: BlockService;
      reports: ReportRepository;
      requests: RequestRepository;
      events: EventPublisher;
      clock: Clock;
    },
  ) {}

  /** Hides the chat for the blocker and masks them as "Unknown" for the blocked side. */
  async blockConversation(actor: Actor, conversationId: string): Promise<void> {
    const view = await this.deps.chat.view(actor, conversationId);
    await this.deps.blocks.block({
      blocker: view.myPersona,
      blocked: view.otherPersona,
      conversationId: view.conversation.id,
    });
  }

  async report(
    actor: Actor,
    input: {
      conversationId?: string | undefined;
      requestId?: string | undefined;
      reason: ReportReason;
      note?: string | null | undefined;
      alsoBlock: boolean;
    },
  ): Promise<{ id: string }> {
    const note = input.note?.trim() || null;
    if (note && note.length > 1000) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Note must be 1,000 characters or fewer');

    if (input.conversationId) {
      const view = await this.deps.chat.view(actor, input.conversationId);
      // Rule 33: snapshot the last 50 messages now; it survives retention and clearing.
      const evidence = await this.deps.reports.evidenceForConversation(view.conversation.id, LIMITS.REPORT_EVIDENCE_MESSAGES);
      const report = await this.deps.reports.create({
        reporterPersonaId: view.myPersona.id,
        reportedPersonaId: view.otherPersona.id,
        conversationId: view.conversation.id,
        requestId: null,
        reason: input.reason,
        note,
        alsoBlocked: input.alsoBlock,
        evidence,
      });
      if (input.alsoBlock) await this.blockConversation(actor, view.conversation.id);
      await this.published(report.id);
      return report;
    }

    if (input.requestId) {
      const request = await this.deps.requests.findById(input.requestId);
      if (!request || request.suppressed || request.toPersona.accountId !== actor.accountId) {
        throw new DomainError(ErrorCode.NOT_FOUND, 'Request not found');
      }
      const report = await this.deps.reports.create({
        reporterPersonaId: request.toPersona.id,
        reportedPersonaId: request.fromPersona.id,
        conversationId: null,
        requestId: request.id,
        reason: input.reason,
        note,
        alsoBlocked: input.alsoBlock,
        evidence: [
          {
            at: request.createdAt.toISOString(),
            senderCode: request.fromPersona.code,
            senderDisplayName: request.fromPersona.displayName,
            type: 'intro',
            body: request.introMessage,
            deleted: false,
            suppressed: false,
          },
        ],
      });
      if (input.alsoBlock) {
        await this.deps.blocks.block({ blocker: request.toPersona, blocked: request.fromPersona, requestId: request.id });
        if (request.status === 'pending') await this.deps.requests.setStatus(request.id, 'blocked', this.deps.clock.now());
      }
      await this.published(report.id);
      return report;
    }

    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Choose a chat or request to report');
  }

  private published(reportId: string) {
    return this.deps.events.publish({ type: 'report.created', payload: { reportId }, occurredAt: this.deps.clock.now() });
  }
}
