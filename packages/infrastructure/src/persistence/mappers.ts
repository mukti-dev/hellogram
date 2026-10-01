import type { Persona } from '@hellogram/domain';
import { LABEL_ICONS, type LabelIcon } from '@hellogram/shared';

/** Columns needed to build a domain Persona (pinHash is only checked for presence). */
export const personaSelect = {
  id: true,
  accountId: true,
  code: true,
  displayName: true,
  avatarKey: true,
  labelIcon: true,
  labelName: true,
  status: true,
  pauseReason: true,
  isPaid: true,
  acceptRequests: true,
  allowCalls: true,
  allowMedia: true,
  readReceipts: true,
  dndUntil: true,
  defaultRetention: true,
  pinHash: true,
  createdAt: true,
  retiredAt: true,
} as const;

/** As read from the database: the icon is plain text there. */
export type PersonaRow = Omit<Persona, 'hasPin' | 'labelIcon'> & { pinHash: string | null; labelIcon: string };

/** Unknown icon keys (e.g. one removed from the set later) fall back to the plain tag. */
export const toLabelIcon = (icon: string): LabelIcon => ((LABEL_ICONS as readonly string[]).includes(icon) ? (icon as LabelIcon) : 'tag');

export function toPersona({ pinHash, labelIcon, ...row }: PersonaRow): Persona {
  return { ...row, labelIcon: toLabelIcon(labelIcon), hasPin: pinHash !== null };
}
