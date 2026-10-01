import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import type { MeController } from './me.controller.js';
import { confirmEmailBody, meResponse, sessionParams, sessionsResponse, startEmailBody } from './me.schemas.js';

export const meRoutes =
  (controller: MeController): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get('/me', { schema: { response: { 200: meResponse } } }, controller.getMe);
    app.get('/me/sessions', { schema: { response: { 200: sessionsResponse } } }, controller.listSessions);
    app.delete('/me/sessions/:id', { schema: { params: sessionParams } }, controller.revokeSession);
    app.post(
      '/me/email',
      { config: { rateLimit: { max: limit(10), timeWindow: '1 hour' } }, schema: { body: startEmailBody } },
      controller.startEmail,
    );
    app.post('/me/email/verify', { schema: { body: confirmEmailBody } }, controller.confirmEmail);
  };
