import type { PrismaClient } from '@hellogram/db';
import { hasContent, type AccountLifecycleRepository, type PhoneChangeRecord } from '@hellogram/domain';
import { randomUUID } from 'node:crypto';

const phoneChangeSelect = { id: true, accountId: true, newPhone: true, effectiveAt: true } as const;

export class PrismaAccountLifecycleRepository implements AccountLifecycleRepository {
  constructor(private readonly db: PrismaClient) {}

  async requestDeletion(accountId: string, at: Date): Promise<void> {
    await this.db.$transaction(async (tx) => {
      await tx.account.update({ where: { id: accountId }, data: { status: 'pending_deletion', deletedAt: at } });
      await tx.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: at, revokeReason: 'account_deleted' } });
      await tx.pushSubscription.deleteMany({ where: { accountId } });
    });
  }

  async listDueErasures(before: Date, limit: number): Promise<string[]> {
    const rows = await this.db.account.findMany({
      where: { status: 'pending_deletion', deletedAt: { lt: before } },
      select: { id: true },
      orderBy: { deletedAt: 'asc' },
      take: limit,
    });
    return rows.map((r) => r.id);
  }

  async eraseAccount(accountId: string, at: Date): Promise<{ avatarKeys: string[] }> {
    return this.db.$transaction(async (tx) => {
      const personas = await tx.persona.findMany({ where: { accountId }, select: { id: true, code: true, avatarKey: true } });
      const ids = personas.map((p) => p.id);
      for (const p of personas) {
        await tx.retiredCode.upsert({ where: { code: p.code }, create: { code: p.code }, update: {} });
      }
      await tx.persona.updateMany({
        where: { accountId, status: { not: 'retired' } },
        data: { status: 'retired', retiredAt: at, pinHash: null, pauseReason: null },
      });
      await tx.persona.updateMany({ where: { accountId }, data: { avatarKey: null } });
      await tx.conversation.updateMany({
        where: { closedAt: null, OR: [{ personaAId: { in: ids } }, { personaBId: { in: ids } }] },
        data: { closedAt: at },
      });
      // Content erased: the user's own messages lose their text (files are swept next); metadata follows the 180-day rule.
      await tx.message.updateMany({
        where: { senderPersonaId: { in: ids }, contentPurgedAt: null },
        data: { body: null, contentPurgedAt: at },
      });
      await tx.contactRequest.updateMany({
        where: { status: 'pending', OR: [{ fromPersonaId: { in: ids } }, { toPersonaId: { in: ids } }] },
        data: { status: 'expired', respondedAt: at },
      });
      await tx.session.updateMany({ where: { accountId, revokedAt: null }, data: { revokedAt: at, revokeReason: 'account_deleted' } });
      await tx.pushSubscription.deleteMany({ where: { accountId } });
      await tx.subscription.updateMany({ where: { accountId, status: { not: 'cancelled' } }, data: { status: 'cancelled' } });
      await tx.phoneChange.updateMany({ where: { accountId, completedAt: null, cancelledAt: null }, data: { cancelledAt: at } });
      // Anonymise: the phone/email are freed for a future sign-up and no longer stored.
      await tx.account.update({
        where: { id: accountId },
        data: { status: 'deleted', phone: `deleted:${randomUUID()}`, name: null, email: null, emailVerifiedAt: null },
      });
      return { avatarKeys: personas.flatMap((p) => (p.avatarKey ? [p.avatarKey] : [])) };
    });
  }

  async exportData(accountId: string, readable: ReadonlySet<string>): Promise<Record<string, unknown>> {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: { phone: true, name: true, email: true, emailVerifiedAt: true, ageConfirmedAt: true, status: true, createdAt: true },
    });
    const personas = await this.db.persona.findMany({
      where: { accountId },
      select: {
        id: true, code: true, displayName: true, labelIcon: true, labelName: true, status: true, isPaid: true,
        acceptRequests: true, allowCalls: true, readReceipts: true, defaultRetention: true, createdAt: true, retiredAt: true,
      },
    });
    // Locked numbers (not unlocked on this device) are exported without their chats/requests/calls.
    const lockedRows = await this.db.persona.findMany({ where: { accountId, pinHash: { not: null } }, select: { id: true, code: true } });
    const locked = lockedRows.filter((p) => !readable.has(p.id));
    const ids = personas.map((p) => p.id).filter((id) => !locked.some((l) => l.id === id));
    const [consents, sessions, requestsSent, requestsReceived, memberships, calls, blocks, reports, payments] = await Promise.all([
      this.db.consentRecord.findMany({ where: { accountId }, select: { version: true, acceptedAt: true } }),
      this.db.session.findMany({ where: { accountId }, select: { deviceName: true, userAgent: true, createdAt: true, lastSeenAt: true, revokedAt: true } }),
      this.db.contactRequest.findMany({ where: { fromPersonaId: { in: ids } }, select: { introMessage: true, status: true, createdAt: true, to: { select: { code: true } } } }),
      this.db.contactRequest.findMany({ where: { toPersonaId: { in: ids }, suppressed: false }, select: { introMessage: true, status: true, createdAt: true, from: { select: { code: true } } } }),
      this.db.conversationMember.findMany({
        where: { personaId: { in: ids } },
        select: {
          personaId: true, nickname: true, clearedBefore: true, mutedUntil: true,
          conversation: { select: { id: true, retention: true, createdAt: true, closedAt: true } },
        },
      }),
      this.db.call.findMany({
        where: { OR: [{ callerPersonaId: { in: ids } }, { calleePersonaId: { in: ids }, suppressed: false }] },
        select: { status: true, createdAt: true, answeredAt: true, endedAt: true, caller: { select: { code: true } }, callee: { select: { code: true } } },
      }),
      this.db.block.findMany({ where: { blockerAccountId: accountId }, select: { createdAt: true, blockedPersona: { select: { code: true } } } }),
      this.db.report.findMany({ where: { reporterPersonaId: { in: ids } }, select: { reason: true, note: true, status: true, createdAt: true } }),
      this.db.payment.findMany({ where: { subscription: { accountId } }, select: { invoiceNo: true, amountPaise: true, gstPaise: true, paidAt: true } }),
    ]);
    // Messages this user can still see (their side of each chat, after clears).
    const conversations = [];
    for (const m of memberships) {
      const messages = await this.db.message.findMany({
        where: {
          conversationId: m.conversation.id,
          OR: [{ suppressed: false }, { senderPersonaId: m.personaId }],
          ...(m.clearedBefore ? { createdAt: { gt: m.clearedBefore } } : {}),
          hiddenFor: { none: { personaId: m.personaId } },
        },
        orderBy: { createdAt: 'asc' },
        select: {
          createdAt: true, type: true, body: true, senderPersonaId: true, deletedForEveryoneAt: true, expiredAt: true, contentPurgedAt: true,
          attachment: { select: { fileName: true, mimeType: true, sizeBytes: true } },
        },
      });
      conversations.push({
        viaNumber: personas.find((p) => p.id === m.personaId)?.code,
        nickname: m.nickname,
        retention: m.conversation.retention,
        createdAt: m.conversation.createdAt,
        closedAt: m.conversation.closedAt,
        messages: messages.map((x) => ({
          at: x.createdAt,
          fromMe: x.senderPersonaId === m.personaId,
          type: x.type,
          body: hasContent(x) ? x.body : null,
          // File details only; the files themselves are downloaded from the chat.
          ...(x.attachment && hasContent(x) ? { attachment: x.attachment } : {}),
        })),
      });
    }
    return {
      exportedAt: new Date().toISOString(),
      account,
      consents,
      sessions,
      numbers: personas,
      // Rule 15: a blocked request still reads as pending to its sender.
      requestsSent: requestsSent.map((r) => ({ ...r, status: r.status === 'blocked' ? 'pending' : r.status, to: r.to.code })),
      requestsReceived: requestsReceived.map((r) => ({ ...r, from: r.from.code })),
      conversations,
      calls: calls.map((c) => ({ ...c, caller: c.caller.code, callee: c.callee.code })),
      blocked: blocks.map((b) => ({ code: b.blockedPersona.code, at: b.createdAt })),
      reportsFiled: reports,
      payments,
      ...(locked.length
        ? { lockedNumbersOmitted: locked.map((l) => l.code), note: 'Unlock these numbers with their PIN to include their chats.' }
        : {}),
    };
  }

  async isPhoneTaken(phone: string): Promise<boolean> {
    return Boolean(await this.db.account.findUnique({ where: { phone }, select: { id: true } }));
  }

  createPhoneChange(accountId: string, newPhone: string, verifiedAt: Date, effectiveAt: Date): Promise<PhoneChangeRecord> {
    return this.db.phoneChange.create({ data: { accountId, newPhone, verifiedAt, effectiveAt }, select: phoneChangeSelect });
  }

  pendingPhoneChange(accountId: string): Promise<PhoneChangeRecord | null> {
    return this.db.phoneChange.findFirst({
      where: { accountId, completedAt: null, cancelledAt: null },
      orderBy: { verifiedAt: 'desc' },
      select: phoneChangeSelect,
    });
  }

  async cancelPhoneChanges(accountId: string, at: Date): Promise<void> {
    await this.db.phoneChange.updateMany({ where: { accountId, completedAt: null, cancelledAt: null }, data: { cancelledAt: at } });
  }

  async applyDuePhoneChanges(now: Date): Promise<PhoneChangeRecord[]> {
    const due = await this.db.phoneChange.findMany({
      where: { completedAt: null, cancelledAt: null, effectiveAt: { lte: now } },
      select: phoneChangeSelect,
    });
    const applied: PhoneChangeRecord[] = [];
    for (const change of due) {
      if (await this.isPhoneTaken(change.newPhone)) {
        await this.db.phoneChange.update({ where: { id: change.id }, data: { cancelledAt: now } });
        continue;
      }
      await this.db.$transaction([
        this.db.account.update({ where: { id: change.accountId }, data: { phone: change.newPhone } }),
        this.db.phoneChange.update({ where: { id: change.id }, data: { completedAt: now } }),
      ]);
      applied.push(change);
    }
    return applied;
  }
}
