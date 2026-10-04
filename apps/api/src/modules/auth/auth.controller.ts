import type { AuthService, LoginResult } from '@hellogram/application';
import type { ClientInfo } from '@hellogram/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { toProof } from '../shared-proof.js';
import type {
  forgotPasswordBody,
  loginBody,
  loginResendBody,
  loginVerifyBody,
  resetPasswordBody,
  signupBody,
  signupResendBody,
  signupVerifyBody,
} from './auth.schemas.js';
import { isNativeClient, readDeviceToken, readRefreshToken } from './client-tokens.js';
import { setDeviceCookie } from './device-cookie.js';
import { clearRefreshCookie, setRefreshCookie, type CookieSettings } from './refresh-cookie.js';

type Req<TBody> = FastifyRequest<{ Body: TBody }>;

const clientInfo = (request: FastifyRequest, deviceName?: string): ClientInfo => ({
  ip: request.ip,
  userAgent: request.headers['user-agent'],
  deviceName,
});

export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly cookie: CookieSettings,
  ) {}

  signup = async (request: Req<z.infer<typeof signupBody>>) => {
    const { turnstileToken: _t, ...input } = request.body;
    return this.auth.startSignup(input, clientInfo(request));
  };

  signupResend = async (request: Req<z.infer<typeof signupResendBody>>, reply: FastifyReply) => {
    await this.auth.resendSignupCode(request.body.signupId, clientInfo(request));
    return reply.status(204).send();
  };

  signupVerify = async (request: Req<z.infer<typeof signupVerifyBody>>, reply: FastifyReply) => {
    const result = await this.auth.completeSignup(
      { signupId: request.body.signupId, proof: toProof(request.body), deviceId: readDeviceToken(request) },
      clientInfo(request, request.body.deviceName),
    );
    return reply.send(this.session(request, reply, result));
  };

  login = async (request: Req<z.infer<typeof loginBody>>, reply: FastifyReply) => {
    const result = await this.auth.login(
      { phone: request.body.phone, password: request.body.password, deviceId: readDeviceToken(request) },
      clientInfo(request, request.body.deviceName),
    );
    if (result.status === 'verify_device') return reply.send({ status: 'verify_device', ticket: result.ticket });
    return reply.send({ status: 'ok', ...this.session(request, reply, result) });
  };

  loginResend = async (request: Req<z.infer<typeof loginResendBody>>, reply: FastifyReply) => {
    await this.auth.resendDeviceCode(request.body.ticket, clientInfo(request));
    return reply.status(204).send();
  };

  loginVerify = async (request: Req<z.infer<typeof loginVerifyBody>>, reply: FastifyReply) => {
    const result = await this.auth.verifyDevice(
      { ticket: request.body.ticket, proof: toProof(request.body), deviceId: readDeviceToken(request) },
      clientInfo(request, request.body.deviceName),
    );
    return reply.send(this.session(request, reply, result));
  };

  forgotPassword = async (request: Req<z.infer<typeof forgotPasswordBody>>, reply: FastifyReply) => {
    await this.auth.forgotPassword(request.body.phone, clientInfo(request));
    return reply.status(204).send();
  };

  resetPassword = async (request: Req<z.infer<typeof resetPasswordBody>>, reply: FastifyReply) => {
    const result = await this.auth.resetPassword(
      { phone: request.body.phone, password: request.body.password, proof: toProof(request.body), deviceId: readDeviceToken(request) },
      clientInfo(request, request.body.deviceName),
    );
    return reply.send(this.session(request, reply, result));
  };

  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await this.auth.refresh(readRefreshToken(request));
      if (isNativeClient(request)) {
        return reply.send({ accessToken: result.accessToken, expiresIn: result.expiresIn, refreshToken: result.refreshToken });
      }
      setRefreshCookie(reply, result.refreshToken, this.cookie);
      return reply.send({ accessToken: result.accessToken, expiresIn: result.expiresIn });
    } catch (error) {
      if (!isNativeClient(request)) clearRefreshCookie(reply, this.cookie);
      throw error;
    }
  };

  /** Logging out keeps the device remembered: next time the password is enough. */
  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    await this.auth.logout(readRefreshToken(request));
    if (!isNativeClient(request)) clearRefreshCookie(reply, this.cookie);
    return reply.status(204).send();
  };

  /** Browsers get httpOnly cookies; the mobile app gets the tokens to keep in secure storage. */
  private session(request: FastifyRequest, reply: FastifyReply, result: LoginResult) {
    const tokens = { accessToken: result.accessToken, expiresIn: result.expiresIn };
    if (isNativeClient(request)) return { ...tokens, refreshToken: result.refreshToken, deviceToken: result.deviceId };
    setRefreshCookie(reply, result.refreshToken, this.cookie);
    setDeviceCookie(reply, result.deviceId, this.cookie);
    return tokens;
  }
}
