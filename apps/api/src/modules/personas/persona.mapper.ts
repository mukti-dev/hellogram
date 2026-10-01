import type { Persona } from '@hellogram/domain';
import type { OwnPersonaDto } from '@hellogram/shared';

/**
 * Own-persona serializer. Never includes accountId; retired personas never reach here.
 * `unlocked` is the set of persona ids this device has unlocked (Phase 7).
 */
export function toOwnPersonaDto(
  persona: Persona,
  avatarUrl: (key: string | null) => string | null,
  unlocked: ReadonlySet<string> = new Set(),
): OwnPersonaDto {
  return {
    id: persona.id,
    code: persona.code,
    displayName: persona.displayName,
    avatarUrl: avatarUrl(persona.avatarKey),
    labelKind: persona.labelKind,
    labelText: persona.labelText,
    status: persona.status === 'paused' ? 'paused' : 'active',
    pauseReason: persona.pauseReason,
    isPaid: persona.isPaid,
    acceptRequests: persona.acceptRequests,
    allowCalls: persona.allowCalls,
    readReceipts: persona.readReceipts,
    dndUntil: persona.dndUntil?.toISOString() ?? null,
    defaultRetention: persona.defaultRetention,
    hasPin: persona.hasPin,
    locked: persona.hasPin && !unlocked.has(persona.id),
  };
}
