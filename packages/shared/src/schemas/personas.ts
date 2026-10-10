import { z } from 'zod';
import { LABEL_ICONS, LIMITS, RETENTION_OPTIONS } from '../constants.js';
import { CALLER_TUNES, RINGTONES } from '../tones.js';

export const labelIconSchema = z.enum(LABEL_ICONS);
export const retentionSchema = z.enum(RETENTION_OPTIONS);

/** A user's own number. Never returned for anyone else's persona. */
export const ownPersonaSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  displayName: z.string(),
  avatarUrl: z.string().nullable(),
  labelIcon: labelIconSchema,
  labelName: z.string(),
  status: z.enum(['active', 'paused']),
  pauseReason: z.enum(['user', 'billing', 'admin']).nullable(),
  isPaid: z.boolean(),
  acceptRequests: z.boolean(),
  allowCalls: z.boolean(),
  /** Photos and files in this number's chats. */
  allowMedia: z.boolean(),
  readReceipts: z.boolean(),
  dndUntil: z.string().nullable(),
  defaultRetention: retentionSchema,
  /** null = the device's own ringtone. */
  ringtone: z.enum(RINGTONES).nullable(),
  /** What callers hear while this number rings; null = the standard ringback. */
  callerTune: z.enum(CALLER_TUNES).nullable(),
  hasPin: z.boolean(),
  /** True when a PIN is set and this device hasn't unlocked it (Phase 7). */
  locked: z.boolean(),
});
export type OwnPersonaDto = z.infer<typeof ownPersonaSchema>;

export const planSchema = z.object({
  used: z.number().int(),
  max: z.number().int(),
  free: z.number().int(),
  paid: z.number().int(),
  freeLeft: z.number().int(),
});
export type PlanDto = z.infer<typeof planSchema>;

export const personaListSchema = z.object({ items: z.array(ownPersonaSchema), plan: planSchema });
export type PersonaListDto = z.infer<typeof personaListSchema>;

export const createPersonaBody = z.object({
  displayName: z.string().trim().min(1).max(LIMITS.DISPLAY_NAME_MAX),
  /** The user's own label, e.g. "OLX" — required, free text. */
  labelName: z.string().trim().min(1).max(LIMITS.LABEL_NAME_MAX),
  labelIcon: labelIconSchema,
  allowCalls: z.boolean().default(true),
  allowMedia: z.boolean().default(true),
});
export type CreatePersonaBody = z.infer<typeof createPersonaBody>;

export const checkoutSchema = z.object({
  draftId: z.uuid(),
  provider: z.enum(['razorpay', 'dev']),
  payload: z.record(z.string(), z.unknown()),
});
export type CheckoutDto = z.infer<typeof checkoutSchema>;

export const updatePersonaBody = z
  .object({
    displayName: z.string().trim().min(1).max(LIMITS.DISPLAY_NAME_MAX),
    labelName: z.string().trim().min(1).max(LIMITS.LABEL_NAME_MAX),
    labelIcon: labelIconSchema,
    acceptRequests: z.boolean(),
    allowCalls: z.boolean(),
    allowMedia: z.boolean(),
    readReceipts: z.boolean(),
    dndUntil: z.iso.datetime().nullable(),
    defaultRetention: retentionSchema,
    ringtone: z.enum(RINGTONES).nullable(),
    callerTune: z.enum(CALLER_TUNES).nullable(),
  })
  .partial();
export type UpdatePersonaBody = z.infer<typeof updatePersonaBody>;

export const retirePersonaBody = z.object({ confirm: z.string() });

export const shareSchema = z.object({ code: z.string(), url: z.string(), qrSvg: z.string() });
export type ShareDto = z.infer<typeof shareSchema>;
