import type { Persona } from '@hellogram/domain';
import type { CounterpartDto, OwnPersonaBriefDto } from '@hellogram/shared';

export type AvatarUrl = (key: string | null) => string | null;

/** The only shape used for another user's number (golden rule). */
export const toCounterpart = (p: Persona, avatarUrl: AvatarUrl): CounterpartDto => ({
  id: p.id,
  code: p.code,
  displayName: p.displayName,
  avatarUrl: avatarUrl(p.avatarKey),
});

export const toOwnBrief = (p: Persona): OwnPersonaBriefDto => ({
  id: p.id,
  code: p.code,
  displayName: p.displayName,
  labelKind: p.labelKind,
  labelText: p.labelText,
});
