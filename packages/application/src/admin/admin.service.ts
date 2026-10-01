import {
  DomainError,
  can,
  type AdminActor,
  type AdminPermission,
  type AdminRepository,
  type AdminRole,
  type AuditRepository,
  type Clock,
  type GrievanceRepository,
  type GrievanceTicket,
  type PinHasher,
  type ReportSummary,
  type TotpVerifier,
} from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

/**
 * Admin panel use cases. Every view of account-level data (phone, linked numbers,
 * report evidence) writes an AuditLog entry (§8).
 */
export class AdminService {
  constructor(
    private readonly deps: {
      admins: AdminRepository;
      grievances: GrievanceRepository;
      audit: AuditRepository;
      hasher: PinHasher;
      totp: TotpVerifier;
      clock: Clock;
    },
  ) {}

  async login(email: string, password: string, code: string): Promise<AdminActor> {
    const admin = await this.deps.admins.findAdminByEmail(email.trim().toLowerCase());
    const passwordOk = admin ? await this.deps.hasher.verify(admin.passwordHash, password) : false;
    const totpOk = admin ? this.deps.totp.verify(admin.totpSecret, code, this.deps.clock.now()) : false;
    if (!admin || admin.disabledAt || !passwordOk || !totpOk) {
      await this.deps.audit.log({ actorType: 'admin', actorId: admin?.id ?? null, action: 'admin.login_failed', meta: { email } });
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Invalid email, password or code');
    }
    await this.deps.audit.log({ actorType: 'admin', actorId: admin.id, action: 'admin.login' });
    return { adminId: admin.id, role: admin.role };
  }

  /** Bootstrap helper (CLI): returns the TOTP secret to enrol in an authenticator app. */
  async createAdmin(email: string, password: string, role: AdminRole) {
    if (password.length < 12) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Use at least 12 characters');
    const totpSecret = this.deps.totp.generateSecret();
    const { id } = await this.deps.admins.createAdmin({ email, role, passwordHash: await this.deps.hasher.hash(password), totpSecret });
    return { id, totpSecret, otpauthUrl: this.deps.totp.otpauthUrl(totpSecret, email) };
  }

  async me(actor: AdminActor) {
    const admin = await this.deps.admins.findAdmin(actor.adminId);
    if (!admin || admin.disabledAt) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in');
    return { id: admin.id, email: admin.email, role: admin.role };
  }

  async stats(actor: AdminActor) {
    this.require(actor, 'stats:read');
    const now = this.deps.clock.now();
    return {
      ...(await this.deps.admins.stats(new Date(now.getTime() - 24 * 60 * 60 * 1000))),
      ...(await this.deps.grievances.overdue(now)),
    };
  }

  async reports(actor: AdminActor, status?: ReportSummary['status']) {
    this.require(actor, 'reports:read');
    return this.deps.admins.listReports(status, 100);
  }

  async report(actor: AdminActor, id: string) {
    this.require(actor, 'reports:read');
    const report = await this.deps.admins.getReport(id);
    if (!report) throw new DomainError(ErrorCode.NOT_FOUND, 'Report not found');
    await this.audit(actor, 'admin.view_report_evidence', 'report', id);
    return report;
  }

  async setReportStatus(actor: AdminActor, id: string, status: ReportSummary['status']) {
    this.require(actor, 'reports:update');
    await this.deps.admins.setReportStatus(id, status, actor.adminId, this.deps.clock.now());
    await this.audit(actor, 'admin.report_status', 'report', id, { status });
  }

  async lookup(actor: AdminActor, query: { code?: string | undefined; accountId?: string | undefined }) {
    this.require(actor, 'accounts:lookup');
    const result = query.code
      ? await this.deps.admins.lookupByCode(query.code)
      : query.accountId
        ? await this.deps.admins.lookupByAccount(query.accountId)
        : null;
    if (!result) throw new DomainError(ErrorCode.NOT_FOUND, 'No account for that number');
    await this.audit(actor, 'admin.view_account_personas', 'account', result.accountId, { via: query.code ?? 'accountId' });
    return result;
  }

  async accountAction(
    actor: AdminActor,
    input: {
      accountId: string;
      action: 'warn' | 'suspend' | 'unsuspend' | 'ban' | 'unban';
      reason: string;
      untilHours?: number | undefined;
      reportId?: string | undefined;
    },
  ) {
    this.require(actor, input.action === 'ban' || input.action === 'unban' ? 'accounts:ban' : 'accounts:warn_suspend');
    if (!input.reason.trim()) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Give a reason');
    const now = this.deps.clock.now();
    const until = input.action === 'suspend' ? new Date(now.getTime() + (input.untilHours ?? 72) * 60 * 60 * 1000) : null;
    await this.deps.admins.applyAccountAction({
      accountId: input.accountId,
      adminId: actor.adminId,
      action: input.action,
      reason: input.reason.trim(),
      until,
      reportId: input.reportId ?? null,
      at: now,
    });
    await this.audit(actor, `admin.account_${input.action}`, 'account', input.accountId, { reason: input.reason, until });
  }

  async auditLog(actor: AdminActor, before?: Date) {
    this.require(actor, 'audit:read');
    return this.deps.admins.listAudit(100, before ?? null);
  }

  async grievances(actor: AdminActor, status?: GrievanceTicket['status']) {
    this.require(actor, 'grievances:manage');
    const now = this.deps.clock.now();
    return (await this.deps.grievances.list(status)).map((g) => ({
      ...g,
      ackOverdue: !g.ackAt && g.ackDueAt < now,
      resolveOverdue: !g.resolvedAt && g.resolveDueAt < now,
    }));
  }

  async setGrievanceStatus(actor: AdminActor, id: string, status: GrievanceTicket['status']) {
    this.require(actor, 'grievances:manage');
    const updated = await this.deps.grievances.setStatus(id, status, this.deps.clock.now());
    if (!updated) throw new DomainError(ErrorCode.NOT_FOUND, 'Ticket not found');
    await this.audit(actor, 'admin.grievance_status', 'grievance', id, { status });
    return updated;
  }

  async legalRequests(actor: AdminActor) {
    this.require(actor, 'legal:manage');
    return this.deps.admins.listLegalRequests();
  }

  async createLegalRequest(
    actor: AdminActor,
    input: { authority: string; referenceNo: string; scope: string; receivedAt: Date; notes?: string | null | undefined },
  ) {
    this.require(actor, 'legal:manage');
    const created = await this.deps.admins.createLegalRequest({ ...input, notes: input.notes ?? null, handledById: actor.adminId });
    await this.audit(actor, 'admin.legal_request_logged', 'legal_request', created.id);
    return created;
  }

  async updateLegalRequest(actor: AdminActor, id: string, patch: { respondedAt?: Date | null; notes?: string | null }) {
    this.require(actor, 'legal:manage');
    await this.deps.admins.updateLegalRequest(id, patch);
    await this.audit(actor, 'admin.legal_request_updated', 'legal_request', id);
  }

  private require(actor: AdminActor, permission: AdminPermission) {
    if (!can(actor.role, permission)) throw new DomainError(ErrorCode.FORBIDDEN, 'Your role can’t do that');
  }

  private audit(actor: AdminActor, action: string, targetType: string, targetId: string, meta?: Record<string, unknown>) {
    return this.deps.audit.log({ actorType: 'admin', actorId: actor.adminId, action, targetType, targetId, ...(meta ? { meta } : {}) });
  }
}
