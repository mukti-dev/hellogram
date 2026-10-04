export const LIMITS = {
  MAX_PERSONAS: 5,
  FREE_PERSONAS: 2,
  NEW_PERSONAS_PER_7_DAYS: 3,
  REQUESTS_PER_DAY: 20,
  REQUEST_COOLDOWN_DAYS: 7,
  REQUEST_EXPIRY_DAYS: 30,
  METADATA_RETENTION_DAYS: 180,
  /** Deleted things (messages, files, photos, accounts) are kept this long, then erased for good. */
  SOFT_DELETE_DAYS: 30,
  REPORT_EVIDENCE_MESSAGES: 50,
  DISPLAY_NAME_MAX: 40,
  LABEL_NAME_MAX: 20,
  NICKNAME_MAX: 40,
  ACCOUNT_NAME_MAX: 50,
  MIN_AGE: 18,
  PASSWORD_MIN: 8,
  PASSWORD_MAX: 128,
  INTRO_MESSAGE_MAX: 300,
  MESSAGE_MAX: 4000,
  PIN_LENGTH: 4,
  OTP_LENGTH: 6,
  CALL_RING_SECONDS: 45,
  PAID_PERSONA_PRICE_PAISE: 4900,
  /** Chat attachments: one file per message. */
  ATTACHMENT_MAX_BYTES: 10 * 1024 * 1024,
  ATTACHMENT_NAME_MAX: 120,
  ATTACHMENT_CAPTION_MAX: 1000,
} as const;

export const RETENTION_OPTIONS = ['forever', 'd90', 'd30', 'd7', 'h24'] as const;
export type Retention = (typeof RETENTION_OPTIONS)[number];

/**
 * Icons a number's label can carry. Labels themselves are free text the user writes
 * (e.g. "OLX", "Dating", "Tenants") — there are no preset labels.
 */
export const LABEL_ICONS = [
  'tag', 'shopping-bag', 'heart', 'home', 'briefcase', 'car', 'graduation-cap', 'stethoscope', 'utensils', 'dumbbell',
  'plane', 'gamepad', 'music', 'paw', 'baby', 'wrench', 'building', 'users', 'gift', 'camera',
] as const;
export type LabelIcon = (typeof LABEL_ICONS)[number];

export const GENDERS = ['male', 'female', 'other', 'prefer_not_to_say'] as const;
export type Gender = (typeof GENDERS)[number];
