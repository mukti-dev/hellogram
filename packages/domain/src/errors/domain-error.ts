import type { ErrorCode } from '@hellogram/shared';

/**
 * The only error type services and domain code throw for expected failures.
 * The API's error handler maps `code` to an HTTP status and response body,
 * so controllers never need try/catch.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
