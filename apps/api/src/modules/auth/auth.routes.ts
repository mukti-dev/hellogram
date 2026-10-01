import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { FastifyRequest } from 'fastify';
import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthController } from './auth.controller.js';
import {
  firebaseLoginBody,
  loginResponse,
  sendEmailOtpBody,
  sendPhoneOtpBody,
  tokenResponse,
  verifyEmailOtpBody,
  verifyPhoneOtpBody,
} from './auth.schemas.js';

/**
 * CSRF defence for cookie-authenticated endpoints: browsers can't add a custom
 * header cross-site without a CORS preflight, which our strict CORS rejects.
 */
export const CLIENT_HEADER = 'x-hellogram-client';
const requireClientHeader = async (request: FastifyRequest) => {
  if (!request.headers[CLIENT_HEADER]) {
    throw new DomainError(ErrorCode.FORBIDDEN, 'Missing client header');
  }
};

export const authRoutes =
  (controller: AuthController, phoneAuth: 'otp' | 'firebase' = 'otp'): FastifyPluginAsyncZod =>
  async (app) => {
    /** Lets the web app confirm which phone verification the server expects. */
    app.get('/auth/config', async () => ({ phoneAuth }));
    // Built at registration time so the dev multiplier (set at boot) applies.
    const otpSendLimit = { rateLimit: { max: limit(10), timeWindow: '1 hour' } };
    const otpVerifyLimit = { rateLimit: { max: limit(30), timeWindow: '15 minutes' } };

    app.post('/auth/otp/send', { config: otpSendLimit, preHandler: app.requireHuman, schema: { body: sendPhoneOtpBody } }, controller.sendPhoneOtp);
    app.post(
      '/auth/otp/verify',
      { config: otpVerifyLimit, schema: { body: verifyPhoneOtpBody, response: { 200: loginResponse } } },
      controller.verifyPhoneOtp,
    );
    app.post(
      '/auth/firebase',
      { config: otpVerifyLimit, schema: { body: firebaseLoginBody, response: { 200: loginResponse } } },
      controller.verifyFirebase,
    );
    app.post('/auth/email/otp/send', { config: otpSendLimit, preHandler: app.requireHuman, schema: { body: sendEmailOtpBody } }, controller.sendEmailOtp);
    app.post(
      '/auth/email/otp/verify',
      { config: otpVerifyLimit, schema: { body: verifyEmailOtpBody, response: { 200: loginResponse } } },
      controller.verifyEmailOtp,
    );
    app.post(
      '/auth/refresh',
      {
        config: { rateLimit: { max: limit(60), timeWindow: '1 minute' } },
        preHandler: requireClientHeader,
        schema: { response: { 200: tokenResponse } },
      },
      controller.refresh,
    );
    app.post('/auth/logout', { preHandler: requireClientHeader }, controller.logout);
  };
