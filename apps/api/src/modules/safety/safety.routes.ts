import type { SafetyService } from '@hellogram/application';
import { reportBody } from '@hellogram/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';
import { limit } from '../../plugins/rate-limit.js';

export const safetyRoutes =
  (safety: SafetyService): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.post('/conversations/:id/block', { schema: { params: z.object({ id: z.uuid() }) } }, async (request, reply) => {
      await safety.blockConversation(actorOf(request), request.params.id);
      return reply.status(204).send();
    });

    app.post(
      '/reports',
      {
        config: { rateLimit: { max: limit(20), timeWindow: '1 hour' } },
        schema: { body: reportBody, response: { 201: z.object({ id: z.uuid() }) } },
      },
      async (request, reply) => reply.status(201).send(await safety.report(actorOf(request), request.body)),
    );
  };
