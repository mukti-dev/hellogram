import type { FastifyRequest } from 'fastify';
import { readDeviceCookie } from './device-cookie.js';
import { readRefreshCookie } from './refresh-cookie.js';

/**
 * The mobile app has no browser cookie jar, so it keeps the refresh and device tokens in the
 * phone's secure storage and sends them as headers; sign-ins return them in the body.
 *
 * Only for requests without an Origin header: browsers always send one on these POSTs, so a
 * script in a web page can never switch to this mode and read the long-lived tokens.
 */
/** Every app request carries it ("web" or "native"); it is also the CSRF guard in auth.routes. */
export const CLIENT_HEADER = 'x-hellogram-client';
const REFRESH_HEADER = 'x-refresh-token';
const DEVICE_HEADER = 'x-device-token';

export const isNativeClient = (request: FastifyRequest): boolean =>
  request.headers[CLIENT_HEADER] === 'native' && request.headers.origin === undefined;

const header = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined;
};

export const readRefreshToken = (request: FastifyRequest): string | undefined =>
  isNativeClient(request) ? header(request, REFRESH_HEADER) : readRefreshCookie(request);

export const readDeviceToken = (request: FastifyRequest): string | undefined =>
  isNativeClient(request) ? header(request, DEVICE_HEADER) : readDeviceCookie(request);
