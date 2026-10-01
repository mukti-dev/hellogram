export const LIMITS = {
  MAX_PERSONAS: 5,
  FREE_PERSONAS: 2,
  NEW_PERSONAS_PER_7_DAYS: 3,
  REQUESTS_PER_DAY: 20,
  REQUEST_COOLDOWN_DAYS: 7,
  REQUEST_EXPIRY_DAYS: 30,
  METADATA_RETENTION_DAYS: 180,
  REPORT_EVIDENCE_MESSAGES: 50,
  DISPLAY_NAME_MAX: 40,
  LABEL_TEXT_MAX: 16,
  NICKNAME_MAX: 40,
  INTRO_MESSAGE_MAX: 300,
  MESSAGE_MAX: 4000,
  PIN_LENGTH: 4,
  OTP_LENGTH: 6,
  DELETE_FOR_EVERYONE_WINDOW_MIN: 60,
  CALL_RING_SECONDS: 45,
  PAID_PERSONA_PRICE_PAISE: 4900,
} as const;

export const RETENTION_OPTIONS = ['forever', 'd90', 'd30', 'd7', 'h24'] as const;
export type Retention = (typeof RETENTION_OPTIONS)[number];

export const LABEL_KINDS = ['olx', 'dating', 'tenants', 'other'] as const;
export type LabelKind = (typeof LABEL_KINDS)[number];
