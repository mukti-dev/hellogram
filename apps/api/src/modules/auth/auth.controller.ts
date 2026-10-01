import type { AuthService, LoginResult } from '@hellogram/application';
import type { ClientInfo } from '@hellogram/domain';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { firebaseLoginBody, sendEmailOtpBody, sendPhoneOtpBody, verifyEmailOtpBody, verifyPhoneOtpBody } from './auth.schemas.js';
import { clearRefreshCookie, readRefreshCookie, setRefreshCookie, type CookieSettings } from './refresh-cookie.js';

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

  sendPhoneOtp = async (request: Req<z.infer<typeof sendPhoneOtpBody>>, reply: FastifyReply) => {
    await this.auth.sendPhoneOtp(request.body.phone, clientInfo(request));
    return reply.status(204).send();
  };

  verifyPhoneOtp = async (request: Req<z.infer<typeof verifyPhoneOtpBody>>, reply: FastifyReply) => {
    const { deviceName, ...input } = request.body;
    return this.login(reply, await this.auth.verifyPhoneOtp(input, clientInfo(request, deviceName)));
  };

  verifyFirebase = async (request: Req<z.infer<typeof firebaseLoginBody>>, reply: FastifyReply) => {
    const { deviceName, ...input } = request.body;
    return this.login(reply, await this.auth.verifyFirebaseLogin(input, clientInfo(request, deviceName)));
  };

  sendEmailOtp = async (request: Req<z.infer<typeof sendEmailOtpBody>>, reply: FastifyReply) => {
    await this.auth.sendEmailLoginOtp(request.body.email, clientInfo(request));
    return reply.status(204).send();
  };

  verifyEmailOtp = async (request: Req<z.infer<typeof verifyEmailOtpBody>>, reply: FastifyReply) => {
    const { deviceName, ...input } = request.body;
    return this.login(reply, await this.auth.verifyEmailOtp(input, clientInfo(request, deviceName)));
  };

  refresh = async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const result = await this.auth.refresh(readRefreshCookie(request));
      setRefreshCookie(reply, result.refreshToken, this.cookie);
      return reply.send({ accessToken: result.accessToken, expiresIn: result.expiresIn });
    } catch (error) {
      clearRefreshCookie(reply, this.cookie);
      throw error;
    }
  };

  logout = async (request: FastifyRequest, reply: FastifyReply) => {
    await this.auth.logout(readRefreshCookie(request));
    clearRefreshCookie(reply, this.cookie);
    return reply.status(204).send();
  };

  private login(reply: FastifyReply, result: LoginResult) {
    setRefreshCookie(reply, result.refreshToken, this.cookie);
    return reply.send({
      accessToken: result.accessToken,
      expiresIn: result.expiresIn,
      isNewAccount: result.isNewAccount,
    });
  }
}
