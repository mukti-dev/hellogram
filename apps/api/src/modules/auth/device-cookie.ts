import type { FastifyReply, FastifyRequest } from 'fastify';
import type { CookieSettings } from './refresh-cookie.js';

/**
 * Identifies this browser to the server ("this device has verified the mobile number").
 * httpOnly, so scripts can't read or copy it; only the auth endpoints receive it.
 */
export const DEVICE_COOKIE = 'hg_dev';
const PATH = '/v1/auth';
const MAX_AGE_SECONDS = 400 * 24 * 60 * 60; // the most browsers allow

export const readDeviceCookie = (request: FastifyRequest): string | undefined => request.cookies[DEVICE_COOKIE];

export const setDeviceCookie = (reply: FastifyReply, deviceId: string, settings: CookieSettings) =>
  reply.setCookie(DEVICE_COOKIE, deviceId, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'strict',
    path: PATH,
    maxAge: MAX_AGE_SECONDS,
  });
