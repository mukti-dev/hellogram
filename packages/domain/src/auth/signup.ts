import { ErrorCode, GENDERS, LIMITS, type Gender } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';

/** Whole years between a date of birth and `today`, by calendar date. */
export function ageOn(dateOfBirth: Date, today: Date): number {
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const beforeBirthday =
    today.getUTCMonth() < dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() && today.getUTCDate() < dateOfBirth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/** "YYYY-MM-DD" → a real calendar date at 18+ (rule 1: adults only). */
export function parseAdultDateOfBirth(input: string, now: Date): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.trim());
  const date = match ? new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]))) : null;
  // Reject impossible dates like 2001-02-30 (Date would roll them over).
  if (!date || date.toISOString().slice(0, 10) !== input.trim()) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Enter a valid date of birth');
  }
  // Compare in India time, where the app runs: someone turns 18 on their birthday in IST.
  const todayIst = new Date(now.getTime() + 5.5 * 60 * 60 * 1000);
  const age = ageOn(date, todayIst);
  if (age < 0 || age > 120) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Enter a valid date of birth');
  if (age < LIMITS.MIN_AGE) throw new DomainError(ErrorCode.UNDER_AGE, 'You must be 18 or older to use Hellogram');
  return date;
}

export function parseGender(input: string): Gender {
  if (!(GENDERS as readonly string[]).includes(input)) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Choose a gender option');
  return input as Gender;
}

/** Long enough, not trivially guessable, not the phone number itself. No composition rules (NIST 800-63B). */
const COMMON = new Set([
  'password', 'password1', 'password123', '12345678', '123456789', '1234567890', '11111111', '00000000',
  'qwerty123', 'qwertyuiop', 'iloveyou', 'abcd1234', 'abc12345', 'hellogram', 'hellogram1', 'hellogram123',
  'welcome1', 'welcome123', 'india123', 'admin123', 'letmein1', '87654321', '1q2w3e4r', 'asdfghjkl',
]);

export function assertStrongPassword(password: string, phone: string): void {
  if (password.length < LIMITS.PASSWORD_MIN) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, `Use at least ${LIMITS.PASSWORD_MIN} characters for your password`);
  }
  if (password.length > LIMITS.PASSWORD_MAX) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, `Passwords can be up to ${LIMITS.PASSWORD_MAX} characters`);
  }
  const lower = password.toLowerCase();
  const digits = phone.replace(/\D/g, '').slice(-10);
  if (COMMON.has(lower) || /^(.)\1+$/.test(password) || (digits && lower.includes(digits))) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'That password is too easy to guess. Choose another.');
  }
}

/** What we hold between "sign up" and "mobile verified" (15 minutes, in Redis). Never the plain password. */
export interface PendingSignup {
  name: string;
  phone: string;
  dateOfBirth: string;
  gender: Gender;
  passwordHash: string;
  consentVersion: string;
}

/** A correct password on a device that hasn't been verified yet: waiting for the OTP. */
export interface PendingDeviceLogin {
  accountId: string;
  phone: string;
}
