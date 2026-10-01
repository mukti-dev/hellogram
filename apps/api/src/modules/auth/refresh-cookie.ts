import type { FastifyReply, FastifyRequest } from 'fastify';

export const REFRESH_COOKIE = 'hg_rt';
const PATH = '/v1/auth';

export interface CookieSettings {
  secure: boolean;
  maxAgeDays: number;
}

export const setRefreshCookie = (reply: FastifyReply, token: string, settings: CookieSettings) =>
  reply.setCookie(REFRESH_COOKIE, token, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'strict',
    path: PATH,
    maxAge: settings.maxAgeDays * 24 * 60 * 60,
  });

export const clearRefreshCookie = (reply: FastifyReply, settings: CookieSettings) =>
  reply.clearCookie(REFRESH_COOKIE, { httpOnly: true, secure: settings.secure, sameSite: 'strict', path: PATH });

export const readRefreshCookie = (request: FastifyRequest): string | undefined => request.cookies[REFRESH_COOKIE];
