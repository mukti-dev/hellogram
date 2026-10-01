import type { CallService } from '@hellogram/application';
import { callAcceptSchema, callLogEntrySchema, callStartSchema } from '@hellogram/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';
import { limit } from '../../plugins/rate-limit.js';
import { toCounterpart, toOwnBrief, type AvatarUrl } from '../shared-mappers.js';

const params = z.object({ id: z.uuid() });

export const callRoutes =
  (calls: CallService, avatarUrl: AvatarUrl): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.post(
      '/calls',
      {
        config: { rateLimit: { max: limit(10), timeWindow: '10 minutes' } },
        schema: { body: z.object({ conversationId: z.uuid() }), response: { 201: callStartSchema } },
      },
      async (request, reply) => reply.status(201).send(await calls.start(actorOf(request), request.body.conversationId)),
    );

    app.post('/calls/:id/accept', { schema: { params, response: { 200: callAcceptSchema } } }, async (request) =>
      calls.accept(actorOf(request), request.params.id),
    );

    app.post('/calls/:id/decline', { schema: { params } }, async (request, reply) => {
      await calls.decline(actorOf(request), request.params.id);
      return reply.status(204).send();
    });

    app.post('/calls/:id/end', { schema: { params } }, async (request, reply) => {
      await calls.end(actorOf(request), request.params.id);
      return reply.status(204).send();
    });

    app.get(
      '/calls',
      {
        schema: {
          querystring: z.object({ personaId: z.uuid().optional(), cursor: z.string().max(200).optional() }),
          response: { 200: z.object({ items: z.array(callLogEntrySchema), nextCursor: z.string().nullable() }) },
        },
      },
      async (request) => {
        const page = await calls.log(actorOf(request), request.query);
        return {
          items: page.items.map(({ call, me, other, direction, outcome, masked }) => ({
            id: call.id,
            conversationId: call.conversationId,
            direction,
            outcome,
            me: toOwnBrief(me),
            counterpart: masked
              ? { id: call.conversationId, code: '', displayName: 'Unknown', avatarUrl: null }
              : toCounterpart(other, avatarUrl),
            startedAt: call.createdAt.toISOString(),
            durationSeconds:
              call.answeredAt && call.endedAt ? Math.round((call.endedAt.getTime() - call.answeredAt.getTime()) / 1000) : null,
          })),
          nextCursor: page.nextCursor,
        };
      },
    );
  };
