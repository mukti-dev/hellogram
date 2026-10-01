import {
  incomingRequestSchema,
  pageSchema,
  sendRequestBody,
  sentRequestSchema,
} from '@hellogram/shared';
import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { RequestController } from './request.controller.js';

const params = z.object({ id: z.uuid() });

export const requestRoutes =
  (controller: RequestController): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get(
      '/requests',
      {
        schema: {
          querystring: z.object({
            status: z.enum(['pending', 'blocked']).optional(),
            personaId: z.uuid().optional(),
            cursor: z.string().max(200).optional(),
          }),
          response: { 200: pageSchema(incomingRequestSchema) },
        },
      },
      controller.listIncoming,
    );
    app.get('/requests/count', { schema: { response: { 200: z.object({ count: z.number().int() }) } } }, controller.pendingCount);
    app.get(
      '/requests/sent',
      { schema: { querystring: z.object({ cursor: z.string().max(200).optional() }), response: { 200: pageSchema(sentRequestSchema) } } },
      controller.listSent,
    );
    app.post(
      '/requests',
      {
        config: { rateLimit: { max: limit(30), timeWindow: '1 hour' } },
        schema: { body: sendRequestBody, response: { 201: sentRequestSchema } },
      },
      controller.send,
    );
    app.post(
      '/requests/:id/accept',
      { schema: { params, response: { 200: z.object({ conversationId: z.uuid() }) } } },
      controller.accept,
    );
    app.post('/requests/:id/decline', { schema: { params } }, controller.decline);
    app.post('/requests/:id/block', { schema: { params } }, controller.block);
  };
