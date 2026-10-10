import { LIMITS, type ChatRetention, type ConversationDto } from '@hellogram/shared';
import { t } from '../../../i18n/t.js';

const MINUTE = 60_000;
const PRESET_MINUTES: Record<Exclude<ChatRetention, 'forever' | 'custom'>, number> = {
  d90: 90 * 24 * 60,
  d30: 30 * 24 * 60,
  d7: 7 * 24 * 60,
  h24: 24 * 60,
};

/** "2 h 30 min", "5 h", "45 min". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h && m) return t('chat.customDuration', { h, m });
  return h ? t('chat.durationHours', { h }) : t('chat.durationMinutes', { m });
}

/** How long a chat keeps messages, as text ("30 days", "2 h 30 min"); null for forever. */
export function retentionPeriod(retention: ChatRetention, minutes: number | null | undefined): string | null {
  if (retention === 'forever') return null;
  if (retention === 'custom') return minutes ? formatMinutes(minutes) : null;
  return t(`numbers.retention.${retention}`);
}

/** Messages older than this disappear (null = kept forever). */
export function retentionMs(c: Pick<ConversationDto, 'retention' | 'retentionMinutes'>): number | null {
  if (c.retention === 'forever') return null;
  if (c.retention === 'custom') return c.retentionMinutes ? c.retentionMinutes * MINUTE : null;
  return PRESET_MINUTES[c.retention] * MINUTE;
}

export const validCustomMinutes = (total: number) =>
  Number.isInteger(total) && total >= LIMITS.CUSTOM_RETENTION_MIN_MINUTES && total <= LIMITS.CUSTOM_RETENTION_MAX_MINUTES;
