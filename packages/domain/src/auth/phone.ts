import { ErrorCode } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';

/**
 * v1 accepts Indian mobile numbers only (+91, 10 digits starting 6–9).
 * Restricting to one country also limits SMS-pumping fraud.
 * Returns E.164, e.g. "+919876543210".
 */
export function normalizeIndianMobile(input: string): string {
  const digits = input.replace(/[\s\-()]/g, '');
  const match = /^(?:\+?91|0)?([6-9]\d{9})$/.exec(digits);
  if (!match) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Enter a valid 10-digit Indian mobile number');
  }
  return `+91${match[1]}`;
}

/** "+919876543210" → "+91 98765 43210" (only ever shown to the owner). */
export function formatIndianMobile(e164: string): string {
  const local = e164.replace(/^\+91/, '');
  return `+91 ${local.slice(0, 5)} ${local.slice(5)}`;
}

export function normalizeEmail(input: string): string {
  return input.trim().toLowerCase();
}
