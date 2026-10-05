import { z } from 'zod';
import { LIMITS } from '../constants.js';

/**
 * How long an unlocked chat or a revealed hidden space stays open, in seconds.
 * 0 = "Immediately": open until the user leaves it (the app forgets the token).
 */
export const VAULT_OPEN_DURATIONS = [
  0, 300, 600, 900, 1200, 1500, 1800, 2100, 2400, 2700, 3000, 3300, 3600, 7200,
] as const;
export const vaultOpenDurationSchema = z.literal(VAULT_OPEN_DURATIONS);
export type VaultOpenDuration = (typeof VAULT_OPEN_DURATIONS)[number];

export const vaultPinSchema = z.string().regex(new RegExp(`^\\d{${LIMITS.PIN_LENGTH}}$`), 'PIN must be 4 digits');

/** The vault row above the inbox. Hidden chats are never counted here. */
export const vaultSummarySchema = z.object({
  lockPinSet: z.boolean(),
  archived: z.number().int(),
  locked: z.number().int(),
});
export type VaultSummaryDto = z.infer<typeof vaultSummarySchema>;

export const setLockPinBody = z.object({ pin: vaultPinSchema, currentPin: vaultPinSchema.optional() });
export type SetLockPinBody = z.infer<typeof setLockPinBody>;

/**
 * Move a chat: back to the inbox, archive it, lock it (needs the chat lock PIN) or hide it
 * (needs a hide PIN; `newSpace: true` confirms a PIN that opens no hidden space yet).
 */
export const moveToVaultBody = z.object({
  to: z.enum(['inbox', 'archived', 'locked', 'hidden']),
  pin: vaultPinSchema.optional(),
  newSpace: z.boolean().optional(),
});
export type MoveToVaultBody = z.infer<typeof moveToVaultBody>;

export const vaultOpenBody = z.object({ pin: vaultPinSchema, duration: vaultOpenDurationSchema });
export type VaultOpenBody = z.infer<typeof vaultOpenBody>;

/** Send it in `X-Vault-Unlock` (comma-separated, with any others) until `expiresAt`. */
export const vaultTokenSchema = z.object({ token: z.string(), expiresAt: z.string() });
export type VaultTokenDto = z.infer<typeof vaultTokenSchema>;

/** Forgot PIN: `lock` sets a new chat lock PIN; `hidden` returns every hidden chat to the inbox. */
export const vaultResetTargetSchema = z.enum(['lock', 'hidden']);
export type VaultResetTarget = z.infer<typeof vaultResetTargetSchema>;
