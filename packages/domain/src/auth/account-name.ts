import { ErrorCode, LIMITS } from '@hellogram/shared';
import { DomainError } from '../errors/domain-error.js';

/** The person's own name: trimmed, single-spaced, no control characters or symbols-only names. */
export function normalizeAccountName(input: string): string {
  const name = input.replace(/\p{Cc}/gu, '').replace(/\s+/g, ' ').trim();
  if (!name) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Enter your name');
  if (name.length > LIMITS.ACCOUNT_NAME_MAX) {
    throw new DomainError(ErrorCode.VALIDATION_FAILED, `Names can be up to ${LIMITS.ACCOUNT_NAME_MAX} characters`);
  }
  if (!/\p{L}/u.test(name)) throw new DomainError(ErrorCode.VALIDATION_FAILED, 'Enter your name using letters');
  return name;
}
