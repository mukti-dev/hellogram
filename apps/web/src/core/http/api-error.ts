import type { ApiErrorBody, ErrorCode } from '@hellogram/shared';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR',
    message: string,
    public readonly details?: unknown,
    /** The raw JSON body, for non-standard error payloads (e.g. 402 { checkout }). */
    public readonly raw?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  static async fromResponse(res: Response): Promise<ApiError> {
    try {
      const body = (await res.json()) as Partial<ApiErrorBody>;
      if (body.error) return new ApiError(res.status, body.error.code, body.error.message, body.error.details, body);
      return new ApiError(res.status, 'PAYMENT_REQUIRED', 'Payment required', undefined, body);
    } catch {
      return new ApiError(res.status, 'INTERNAL', 'Something went wrong');
    }
  }
}
