export const OTP_RULES = {
  length: 6,
  ttlMs: 5 * 60 * 1000,
  maxAttempts: 5,
  /** Max OTP sends per target (phone/email) per window. */
  sendLimit: 3,
  sendWindowSeconds: 15 * 60,
  resendAfterSeconds: 30,
} as const;

export const isOtpFormat = (code: string): boolean => /^\d{6}$/.test(code);
