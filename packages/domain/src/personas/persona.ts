import { ErrorCode, LIMITS, type LabelKind, type Retention } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';

export type PersonaStatus = 'active' | 'paused' | 'retired';
export type PauseReason = 'user' | 'billing' | 'admin';

export interface Persona {
  id: string;
  accountId: string;
  code: string;
  displayName: string;
  avatarKey: string | null;
  labelKind: LabelKind;
  labelText: string | null;
  status: PersonaStatus;
  pauseReason: PauseReason | null;
  isPaid: boolean;
  acceptRequests: boolean;
  allowCalls: boolean;
  readReceipts: boolean;
  dndUntil: Date | null;
  defaultRetention: Retention;
  hasPin: boolean;
  createdAt: Date;
  retiredAt: Date | null;
}

export const isLive = (p: Pick<Persona, 'status'>) => p.status !== 'retired';

export interface PlanSummary {
  used: number;
  max: number;
  free: number;
  paid: number;
  freeLeft: number;
}

export function planSummary(personas: readonly Pick<Persona, 'status' | 'isPaid'>[]): PlanSummary {
  const live = personas.filter(isLive);
  const paid = live.filter((p) => p.isPaid).length;
  const freeUsed = live.length - paid;
  return {
    used: live.length,
    max: LIMITS.MAX_PERSONAS,
    free: freeUsed,
    paid,
    freeLeft: Math.max(0, LIMITS.FREE_PERSONAS - freeUsed),
  };
}

/**
 * Rules 5 & 8: max 5 live numbers, first 2 free, max 3 new numbers per 7 days.
 * Returns whether the new number needs a paid slot.
 */
export function assertCanCreatePersona(
  personas: readonly Pick<Persona, 'status' | 'isPaid'>[],
  createdInLast7Days: number,
): { requiresPayment: boolean } {
  const plan = planSummary(personas);
  if (plan.used >= LIMITS.MAX_PERSONAS) {
    throw new DomainError(ErrorCode.PERSONA_LIMIT_REACHED, 'You can have up to 5 numbers');
  }
  if (createdInLast7Days >= LIMITS.NEW_PERSONAS_PER_7_DAYS) {
    throw new DomainError(ErrorCode.PERSONA_CHURN_LIMIT, 'You can create up to 3 new numbers per week');
  }
  return { requiresPayment: plan.freeLeft === 0 };
}

export function normalizeDisplayName(input: string): string {
  const name = input.replace(/\s+/g, ' ').trim();
  if (name.length < 1 || name.length > LIMITS.DISPLAY_NAME_MAX) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Name must be 1–40 characters');
  }
  return name;
}

export function normalizeLabel(kind: LabelKind, text?: string | null): { labelKind: LabelKind; labelText: string | null } {
  if (kind !== 'other') return { labelKind: kind, labelText: null };
  const clean = text?.trim() ?? '';
  if (clean.length > LIMITS.LABEL_TEXT_MAX) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Label must be at most 16 characters');
  }
  return { labelKind: 'other', labelText: clean || null };
}

/** DND counts only while its end time is in the future. */
export const isInDnd = (p: Pick<Persona, 'dndUntil'>, now: Date) => Boolean(p.dndUntil && p.dndUntil > now);

/** Rule 25: a PIN-locked persona's data is only readable once this device unlocked it. */
export function isReadable(p: Pick<Persona, 'id' | 'hasPin'>, unlocked: ReadonlySet<string> | undefined): boolean {
  return !p.hasPin || Boolean(unlocked?.has(p.id));
}
