import type { EvidenceMessage, ReportReason } from '../safety/ports.js';

export type AdminRole = 'moderator' | 'admin' | 'grievance_officer';

export interface AdminActor {
  adminId: string;
  role: AdminRole;
}

export type AdminPermission =
  | 'reports:read'
  | 'reports:update'
  | 'accounts:lookup'
  | 'accounts:warn_suspend'
  | 'accounts:ban'
  | 'audit:read'
  | 'grievances:manage'
  | 'legal:manage'
  | 'stats:read';

const ROLE_PERMISSIONS: Record<AdminRole, AdminPermission[]> = {
  moderator: ['reports:read', 'reports:update', 'accounts:lookup', 'accounts:warn_suspend', 'stats:read'],
  grievance_officer: ['grievances:manage', 'legal:manage', 'accounts:lookup', 'reports:read', 'stats:read'],
  admin: [
    'reports:read',
    'reports:update',
    'accounts:lookup',
    'accounts:warn_suspend',
    'accounts:ban',
    'audit:read',
    'grievances:manage',
    'legal:manage',
    'stats:read',
  ],
};

export const can = (role: AdminRole, permission: AdminPermission) => ROLE_PERMISSIONS[role].includes(permission);

export interface AdminUserRecord {
  id: string;
  email: string;
  role: AdminRole;
  passwordHash: string;
  totpSecret: string;
  disabledAt: Date | null;
}

export interface ReportSummary {
  id: string;
  reason: ReportReason;
  status: 'open' | 'reviewing' | 'actioned' | 'dismissed';
  note: string | null;
  createdAt: Date;
  reporterCode: string;
  reportedCode: string;
  reportedDisplayName: string;
  reportedAccountId: string;
}

export interface ReportDetail extends ReportSummary {
  evidence: EvidenceMessage[];
  alsoBlocked: boolean;
}

export interface AccountLookup {
  accountId: string;
  phone: string;
  email: string | null;
  status: string;
  suspendedUntil: Date | null;
  createdAt: Date;
  personas: { id: string; code: string; displayName: string; status: string; createdAt: Date }[];
  reportsAgainst: number;
  actions: { action: string; reason: string; createdAt: Date; until: Date | null }[];
}

export interface LegalRequestRecord {
  id: string;
  authority: string;
  referenceNo: string;
  scope: string;
  receivedAt: Date;
  respondedAt: Date | null;
  notes: string | null;
}

export interface AdminRepository {
  findAdminByEmail(email: string): Promise<AdminUserRecord | null>;
  findAdmin(id: string): Promise<AdminUserRecord | null>;
  createAdmin(input: { email: string; role: AdminRole; passwordHash: string; totpSecret: string }): Promise<{ id: string }>;
  stats(since: Date): Promise<Record<string, number>>;
  listReports(status: ReportSummary['status'] | undefined, limit: number): Promise<ReportSummary[]>;
  getReport(id: string): Promise<ReportDetail | null>;
  setReportStatus(id: string, status: ReportSummary['status'], adminId: string, at: Date): Promise<void>;
  lookupByCode(code: string): Promise<AccountLookup | null>;
  lookupByAccount(accountId: string): Promise<AccountLookup | null>;
  applyAccountAction(input: {
    accountId: string;
    adminId: string;
    action: 'warn' | 'suspend' | 'unsuspend' | 'ban' | 'unban';
    reason: string;
    until: Date | null;
    reportId: string | null;
    at: Date;
  }): Promise<void>;
  listAudit(limit: number, before: Date | null): Promise<{ id: string; actorType: string; actorId: string | null; action: string; targetType: string | null; targetId: string | null; createdAt: Date }[]>;
  listLegalRequests(): Promise<LegalRequestRecord[]>;
  createLegalRequest(input: { authority: string; referenceNo: string; scope: string; receivedAt: Date; notes: string | null; handledById: string }): Promise<{ id: string }>;
  updateLegalRequest(id: string, patch: { respondedAt?: Date | null; notes?: string | null }): Promise<void>;
}

export interface AuditRepository {
  log(entry: { actorType: 'system' | 'admin' | 'account'; actorId: string | null; action: string; targetType?: string; targetId?: string; meta?: Record<string, unknown> }): Promise<void>;
}

export interface TotpVerifier {
  generateSecret(): string;
  verify(secret: string, code: string, at: Date): boolean;
  otpauthUrl(secret: string, label: string): string;
}
