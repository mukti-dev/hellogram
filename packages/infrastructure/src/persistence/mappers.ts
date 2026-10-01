import type { Persona } from '@hellogram/domain';

/** Columns needed to build a domain Persona (pinHash is only checked for presence). */
export const personaSelect = {
  id: true,
  accountId: true,
  code: true,
  displayName: true,
  avatarKey: true,
  labelKind: true,
  labelText: true,
  status: true,
  pauseReason: true,
  isPaid: true,
  acceptRequests: true,
  allowCalls: true,
  readReceipts: true,
  dndUntil: true,
  defaultRetention: true,
  pinHash: true,
  createdAt: true,
  retiredAt: true,
} as const;

export type PersonaRow = Omit<Persona, 'hasPin'> & { pinHash: string | null };

export function toPersona({ pinHash, ...row }: PersonaRow): Persona {
  return { ...row, hasPin: pinHash !== null };
}
