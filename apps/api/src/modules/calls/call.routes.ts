import type { CallService } from '@hellogram/application';
import { callAcceptSchema, callLogEntrySchema, callStartSchema, incomingCallSchema } from '@hellogram/shared';
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

    // A device opened from the incoming-call notification asks what's ringing.
    app.get('/calls/:id', { schema: { params, response: { 200: incomingCallSchema } } }, async (request) => {
      const { call, calleeLocked } = await calls.ringing(actorOf(request), request.params.id);
      return {
        callId: call.id,
        conversationId: call.conversationId,
        caller: calleeLocked
          ? null
          : { id: call.caller.id, code: call.caller.code, displayName: call.caller.displayName, avatarUrl: avatarUrl(call.caller.avatarKey) },
        to: { personaId: call.callee.id, code: call.callee.code, labelIcon: call.callee.labelIcon, labelName: call.callee.labelName },
      };
    });

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

/**
 * The notification's Decline button (in the service worker, which has no session). Authorised by
 * the one-call key that came in the push; always 204 so it reveals nothing.
 */
export const callNotificationRoutes =
  (calls: CallService): FastifyPluginAsyncZod =>
  async (app) => {
    app.post(
      '/calls/:id/decline-from-notification',
      {
        config: { rateLimit: { max: limit(20), timeWindow: '1 minute' } },
        schema: { params, body: z.object({ token: z.string().min(16).max(128) }) },
      },
      async (request, reply) => {
        await calls.declineFromNotification(request.params.id, request.body.token);
        return reply.status(204).send();
      },
    );
  };
