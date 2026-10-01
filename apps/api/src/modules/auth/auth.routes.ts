import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { FastifyRequest } from 'fastify';
import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { AuthController } from './auth.controller.js';
import {
  forgotPasswordBody,
  loginBody,
  loginResendBody,
  loginResponse,
  loginVerifyBody,
  passwordLoginResponse,
  resetPasswordBody,
  signupBody,
  signupResendBody,
  signupResponse,
  signupVerifyBody,
  tokenResponse,
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
  (
    controller: AuthController,
    phoneAuth: 'otp' | 'firebase' = 'otp',
    otpDelivery: 'sms' | 'call_or_sms' = 'sms',
    consentVersion = '',
  ): FastifyPluginAsyncZod =>
  async (app) => {
    /** Lets the web app confirm which phone verification the server expects, and how codes arrive. */
    app.get('/auth/config', async () => ({ phoneAuth, otpDelivery, consentVersion }));
    // Built at registration time so the dev multiplier (set at boot) applies.
    const otpSendLimit = { rateLimit: { max: limit(10), timeWindow: '1 hour' } };
    const otpVerifyLimit = { rateLimit: { max: limit(30), timeWindow: '15 minutes' } };

    const loginLimit = { rateLimit: { max: limit(30), timeWindow: '15 minutes' } };

    // Sign-up: details → code to the mobile → account created.
    app.post(
      '/auth/signup',
      { config: otpSendLimit, preHandler: app.requireHuman, schema: { body: signupBody, response: { 200: signupResponse } } },
      controller.signup,
    );
    app.post('/auth/signup/resend', { config: otpSendLimit, schema: { body: signupResendBody } }, controller.signupResend);
    app.post(
      '/auth/signup/verify',
      { config: otpVerifyLimit, schema: { body: signupVerifyBody, response: { 200: loginResponse } } },
      controller.signupVerify,
    );

    // Login: mobile + password; a new device also verifies the mobile once.
    app.post(
      '/auth/login',
      { config: loginLimit, preHandler: app.requireHuman, schema: { body: loginBody, response: { 200: passwordLoginResponse } } },
      controller.login,
    );
    app.post('/auth/login/resend', { config: otpSendLimit, schema: { body: loginResendBody } }, controller.loginResend);
    app.post(
      '/auth/login/verify',
      { config: otpVerifyLimit, schema: { body: loginVerifyBody, response: { 200: loginResponse } } },
      controller.loginVerify,
    );

    // Forgot password: code to the mobile → new password.
    app.post(
      '/auth/password/forgot',
      { config: otpSendLimit, preHandler: app.requireHuman, schema: { body: forgotPasswordBody } },
      controller.forgotPassword,
    );
    app.post(
      '/auth/password/reset',
      { config: otpVerifyLimit, schema: { body: resetPasswordBody, response: { 200: loginResponse } } },
      controller.resetPassword,
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
