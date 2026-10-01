import { pino, type Logger } from 'pino';
import type { ApiEnv } from './env.js';

/**
 * Paths that must never reach logs (phone, email, message bodies, PINs, OTPs, tokens).
 * See docs/ARCHITECTURE.md §11. The dev SMS/email providers log `devOtp` on purpose.
 */
export const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-persona-unlock"]',
  'res.headers["set-cookie"]',
  '*.phone',
  '*.newPhone',
  '*.email',
  '*.body',
  '*.introMessage',
  '*.pin',
  '*.newPin',
  '*.currentPin',
  '*.code',
  '*.otp',
  '*.accessToken',
  '*.refreshToken',
  '*.token',
];

/** Number codes in URLs (public card, share links) are masked; client IPs are never logged raw. */
const maskUrl = (url: string) => url.replace(/\/([A-HJ-NP-Z])\d{6,7}([A-HJ-NP-Z])(?=[/?]|$)/gi, '/$1******$2');

export function createLogger(env: Pick<ApiEnv, 'NODE_ENV' | 'LOG_LEVEL'>): Logger {
  return pino({
    level: env.LOG_LEVEL,
    // devOtp is only emitted by the dev console providers, which production refuses to use.
    redact: { paths: env.NODE_ENV === 'production' ? [...REDACT_PATHS, '*.devOtp', 'devOtp'] : REDACT_PATHS, censor: '[redacted]' },
    serializers: {
      req: (req: { method?: string; url?: string; id?: string }) => ({ id: req.id, method: req.method, url: maskUrl(req.url ?? '') }),
    },
    ...(env.NODE_ENV === 'development'
      ? { transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } }
      : {}),
  });
}
