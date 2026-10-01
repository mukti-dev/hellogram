import type { PrismaClient } from '@hellogram/db';
import type { AccountLookup, AdminRepository, AdminRole, EvidenceMessage, ReportDetail, ReportSummary } from '@hellogram/domain';

const reportSelect = {
  id: true,
  reason: true,
  status: true,
  note: true,
  createdAt: true,
  alsoBlocked: true,
  reporter: { select: { code: true } },
  reported: { select: { code: true, displayName: true, accountId: true } },
} as const;

type ReportRow = {
  id: string;
  reason: ReportSummary['reason'];
  status: ReportSummary['status'];
  note: string | null;
  createdAt: Date;
  alsoBlocked: boolean;
  reporter: { code: string };
  reported: { code: string; displayName: string; accountId: string };
};

const toSummary = (r: ReportRow): ReportSummary => ({
  id: r.id,
  reason: r.reason,
  status: r.status,
  note: r.note,
  createdAt: r.createdAt,
  reporterCode: r.reporter.code,
  reportedCode: r.reported.code,
  reportedDisplayName: r.reported.displayName,
  reportedAccountId: r.reported.accountId,
});

export class PrismaAdminRepository implements AdminRepository {
  constructor(private readonly db: PrismaClient) {}

  findAdminByEmail(email: string) {
    return this.db.adminUser.findUnique({ where: { email: email.toLowerCase() } });
  }

  findAdmin(id: string) {
    return this.db.adminUser.findUnique({ where: { id } });
  }

  createAdmin(input: { email: string; role: AdminRole; passwordHash: string; totpSecret: string }) {
    return this.db.adminUser.create({ data: { ...input, email: input.email.toLowerCase() }, select: { id: true } });
  }

  async stats(since: Date) {
    const [accounts, activeNumbers, messages24h, calls24h, openReports, openGrievances, activeSubscriptions] = await Promise.all([
      this.db.account.count({ where: { status: { not: 'deleted' } } }),
      this.db.persona.count({ where: { status: 'active' } }),
      this.db.message.count({ where: { createdAt: { gte: since } } }),
      this.db.call.count({ where: { createdAt: { gte: since } } }),
      this.db.report.count({ where: { status: { in: ['open', 'reviewing'] } } }),
      this.db.grievanceTicket.count({ where: { status: { in: ['open', 'acknowledged'] } } }),
      this.db.subscription.count({ where: { status: 'active' } }),
    ]);
    return { accounts, activeNumbers, messages24h, calls24h, openReports, openGrievances, activeSubscriptions };
  }

  async listReports(status: ReportSummary['status'] | undefined, limit: number) {
    const rows = await this.db.report.findMany({
      where: status ? { status } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: reportSelect,
    });
    return rows.map(toSummary);
  }

  async getReport(id: string): Promise<ReportDetail | null> {
    const row = await this.db.report.findUnique({ where: { id }, select: { ...reportSelect, evidence: { select: { snapshot: true } } } });
    if (!row) return null;
    return { ...toSummary(row), alsoBlocked: row.alsoBlocked, evidence: (row.evidence?.snapshot as unknown as EvidenceMessage[]) ?? [] };
  }

  async setReportStatus(id: string, status: ReportSummary['status'], adminId: string, at: Date) {
    await this.db.report.update({
      where: { id },
      data: { status, handledByAdminId: adminId, closedAt: status === 'actioned' || status === 'dismissed' ? at : null },
    });
  }

  async lookupByCode(code: string): Promise<AccountLookup | null> {
    const persona = await this.db.persona.findUnique({ where: { code: code.toUpperCase() }, select: { accountId: true } });
    return persona ? this.lookupByAccount(persona.accountId) : null;
  }

  async lookupByAccount(accountId: string): Promise<AccountLookup | null> {
    const account = await this.db.account.findUnique({
      where: { id: accountId },
      select: {
        id: true, phone: true, email: true, status: true, suspendedUntil: true, createdAt: true,
        personas: { select: { id: true, code: true, displayName: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } },
        actions: { select: { action: true, reason: true, createdAt: true, until: true }, orderBy: { createdAt: 'desc' }, take: 20 },
      },
    });
    if (!account) return null;
    const reportsAgainst = await this.db.report.count({ where: { reported: { accountId } } });
    return {
      accountId: account.id,
      phone: account.phone,
      email: account.email,
      status: account.status,
      suspendedUntil: account.suspendedUntil,
      createdAt: account.createdAt,
      personas: account.personas,
      reportsAgainst,
      actions: account.actions,
    };
  }

  async applyAccountAction(input: {
    accountId: string;
    adminId: string;
    action: 'warn' | 'suspend' | 'unsuspend' | 'ban' | 'unban';
    reason: string;
    until: Date | null;
    reportId: string | null;
    at: Date;
  }) {
    await this.db.$transaction(async (tx) => {
      await tx.accountActionLog.create({
        data: { accountId: input.accountId, adminId: input.adminId, action: input.action, reason: input.reason, until: input.until, reportId: input.reportId },
      });
      const statusPatch =
        input.action === 'suspend'
          ? { status: 'suspended' as const, suspendedUntil: input.until }
          : input.action === 'ban'
            ? { status: 'banned' as const, suspendedUntil: null }
            : input.action === 'unsuspend' || input.action === 'unban'
              ? { status: 'active' as const, suspendedUntil: null }
              : null;
      if (statusPatch) await tx.account.update({ where: { id: input.accountId }, data: statusPatch });
      if (input.action === 'suspend' || input.action === 'ban') {
        await tx.session.updateMany({
          where: { accountId: input.accountId, revokedAt: null },
          data: { revokedAt: input.at, revokeReason: 'account_action' },
        });
      }
    });
  }

  listAudit(limit: number, before: Date | null) {
    return this.db.auditLog.findMany({
      where: before ? { createdAt: { lt: before } } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, actorType: true, actorId: true, action: true, targetType: true, targetId: true, createdAt: true },
    });
  }

  listLegalRequests() {
    return this.db.legalRequest.findMany({
      orderBy: { receivedAt: 'desc' },
      select: { id: true, authority: true, referenceNo: true, scope: true, receivedAt: true, respondedAt: true, notes: true },
    });
  }

  createLegalRequest(input: { authority: string; referenceNo: string; scope: string; receivedAt: Date; notes: string | null; handledById: string }) {
    return this.db.legalRequest.create({ data: input, select: { id: true } });
  }

  async updateLegalRequest(id: string, patch: { respondedAt?: Date | null; notes?: string | null }) {
    await this.db.legalRequest.update({ where: { id }, data: patch });
  }
}
