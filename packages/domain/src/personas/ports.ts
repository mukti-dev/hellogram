import type { LabelIcon, Retention } from '@hellogram/shared';
import type { PauseReason, Persona } from './persona.js';

export interface CreatePersonaInput {
  accountId: string;
  code: string;
  displayName: string;
  labelIcon: LabelIcon;
  labelName: string;
  allowCalls: boolean;
  allowMedia: boolean;
  isPaid: boolean;
}

export interface PersonaSettingsPatch {
  displayName?: string;
  avatarKey?: string | null;
  labelIcon?: LabelIcon;
  labelName?: string;
  acceptRequests?: boolean;
  allowCalls?: boolean;
  allowMedia?: boolean;
  readReceipts?: boolean;
  dndUntil?: Date | null;
  defaultRetention?: Retention;
}

export interface PersonaRepository {
  findById(id: string): Promise<Persona | null>;
  findByCode(code: string): Promise<Persona | null>;
  listByAccount(accountId: string): Promise<Persona[]>;
  countCreatedSince(accountId: string, since: Date): Promise<number>;
  /** True if the code exists on any persona or in RetiredCode. */
  codeTaken(code: string): Promise<boolean>;
  /** Returns null when the code collided (unique violation) so the caller can retry. */
  create(input: CreatePersonaInput): Promise<Persona | null>;
  update(id: string, patch: PersonaSettingsPatch): Promise<Persona>;
  setStatus(id: string, status: 'active' | 'paused', pauseReason: PauseReason | null): Promise<Persona>;
  /** Retires the persona, records its code in RetiredCode, closes its conversations. */
  retire(id: string, at: Date): Promise<void>;
  markPaid(id: string, isPaid: boolean): Promise<void>;
}
