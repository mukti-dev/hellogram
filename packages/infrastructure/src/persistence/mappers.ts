import type { Persona } from '@hellogram/domain';
import { LABEL_ICONS, type ChatRetention, type LabelIcon } from '@hellogram/shared';

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

/**
 * As read from the database: the icon is plain text there, and the retention column shares the
 * chats' enum (which also has "custom", never stored as a number's default).
 */
export type PersonaRow = Omit<Persona, 'hasPin' | 'labelIcon' | 'defaultRetention'> & {
  pinHash: string | null;
  labelIcon: string;
  defaultRetention: ChatRetention;
};

/** Unknown icon keys (e.g. one removed from the set later) fall back to the plain tag. */
export const toLabelIcon = (icon: string): LabelIcon => ((LABEL_ICONS as readonly string[]).includes(icon) ? (icon as LabelIcon) : 'tag');

export function toPersona({ pinHash, labelIcon, defaultRetention, ...row }: PersonaRow): Persona {
  return {
    ...row,
    labelIcon: toLabelIcon(labelIcon),
    defaultRetention: defaultRetention === 'custom' ? 'd30' : defaultRetention,
    hasPin: pinHash !== null,
  };
}
