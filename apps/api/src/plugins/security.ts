import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import type { FastifyInstance } from 'fastify';
import fp from 'fastify-plugin';

export interface SecurityOptions {
  corsOrigins: string[];
}

/** Helmet headers, strict CORS (explicit allow-list, credentials for the refresh cookie), cookies. */
export const securityPlugin = fp<SecurityOptions>(async (app: FastifyInstance, options) => {
  await app.register(helmet, {
    // The API only serves JSON; the web app sets its own CSP.
    contentSecurityPolicy: { directives: { defaultSrc: ["'none'"], frameAncestors: ["'none'"] } },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });
  await app.register(cors, {
    origin: options.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Persona-Unlock', 'X-Hellogram-Client', 'X-Request-Id'],
  });
  await app.register(cookie);
});
