import { DomainError } from '@hellogram/domain';
import { ErrorCode, type ApiErrorBody } from '@hellogram/shared';
import type { FastifyError, FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';
import { hasZodFastifySchemaValidationErrors } from 'fastify-type-provider-zod';

const STATUS_BY_CODE: Partial<Record<ErrorCode, number>> = {
  VALIDATION_FAILED: 400,
  MESSAGE_TOO_LONG: 400,
  AGE_CONFIRMATION_REQUIRED: 400,
  // 400, not 401: a 401 would make the web client try a token refresh.
  INVALID_CREDENTIALS: 400,
  UNDER_AGE: 422,
  ACCOUNT_EXISTS: 409,
  OTP_INVALID: 400,
  OTP_EXPIRED: 400,
  PIN_INVALID: 400,
  UNAUTHENTICATED: 401,
  PAYMENT_REQUIRED: 402,
  FORBIDDEN: 403,
  ACCOUNT_RESTRICTED: 403,
  PERSONA_LOCKED: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  REQUEST_ALREADY_PENDING: 409,
  CONVERSATION_CLOSED: 409,
  NUMBER_UNAVAILABLE: 410,
  NUMBER_PAUSED: 409,
  FILE_TOO_LARGE: 413,
  FILE_TYPE_NOT_ALLOWED: 415,
  MEDIA_NOT_ALLOWED: 403,
  OWN_NUMBER: 422,
  NOT_ACCEPTING_REQUESTS: 422,
  CALL_NOT_ALLOWED: 422,
  PERSONA_LIMIT_REACHED: 422,
  PERSONA_CHURN_LIMIT: 429,
  REQUEST_COOLDOWN: 429,
  REQUEST_DAILY_CAP: 429,
  OTP_TOO_MANY_ATTEMPTS: 429,
  PIN_LOCKED_OUT: 429,
  RATE_LIMITED: 429,
  SERVICE_UNAVAILABLE: 503,
};

export const statusForCode = (code: ErrorCode): number => STATUS_BY_CODE[code] ?? 500;

const body = (code: ErrorCode, message: string, details?: unknown): ApiErrorBody => ({
  error: { code, message, ...(details === undefined ? {} : { details }) },
});

/**
 * Single place that turns thrown errors into `{ error: { code, message } }`.
 * Controllers never catch; unexpected errors are logged and hidden from clients.
 */
export const errorHandlerPlugin = fp(async (app: FastifyInstance) => {
  app.setErrorHandler((error: FastifyError, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(statusForCode(error.code)).send(body(error.code, error.message, error.details));
    }

    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send(
        body(ErrorCode.VALIDATION_FAILED, 'Request validation failed', {
          issues: error.validation.map((issue) => ({
            path: issue.instancePath,
            message: issue.message,
          })),
        }),
      );
    }

    if (error.statusCode === 429) {
      return reply.status(429).send(body(ErrorCode.RATE_LIMITED, 'Too many requests. Please try again later.'));
    }

    if (error.statusCode === 413) {
      return reply.status(413).send(body(ErrorCode.FILE_TOO_LARGE, 'That file is too large.'));
    }
    if (error.statusCode && error.statusCode >= 400 && error.statusCode < 500) {
      const code = error.statusCode === 404 ? ErrorCode.NOT_FOUND : ErrorCode.VALIDATION_FAILED;
      return reply.status(error.statusCode).send(body(code, error.message));
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.status(500).send(body(ErrorCode.INTERNAL, 'Something went wrong'));
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send(body(ErrorCode.NOT_FOUND, 'Route not found'));
  });
});
