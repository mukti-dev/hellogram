import {
  conversationSchema,
  inboxSchema,
  labelKindSchema,
  messagePageSchema,
  messageSchema,
  sendMessageBody,
  updateConversationBody,
} from '@hellogram/shared';
import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { ChatController } from './chat.controller.js';

const params = z.object({ id: z.uuid() });

export const chatRoutes =
  (controller: ChatController): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get(
      '/conversations',
      {
        schema: {
          querystring: z.object({
            personaId: z.uuid().optional(),
            label: labelKindSchema.optional(),
            unread: z.stringbool().optional(),
            q: z.string().max(60).optional(),
            cursor: z.string().max(200).optional(),
          }),
          response: { 200: inboxSchema },
        },
      },
      controller.inbox,
    );
    app.get('/conversations/unread-count', { schema: { response: { 200: z.object({ count: z.number().int() }) } } }, controller.unreadCount);
    app.get('/conversations/:id', { schema: { params, response: { 200: conversationSchema } } }, controller.get);
    app.patch(
      '/conversations/:id',
      { schema: { params, body: updateConversationBody, response: { 200: conversationSchema } } },
      controller.update,
    );
    app.post('/conversations/:id/clear', { schema: { params } }, controller.clear);
    app.get(
      '/conversations/:id/messages',
      { schema: { params, querystring: z.object({ cursor: z.string().max(200).optional() }), response: { 200: messagePageSchema } } },
      controller.messages,
    );
    app.post(
      '/conversations/:id/messages',
      {
        // Per-persona 30/min is enforced in ChatService; this is a coarse per-IP ceiling.
        config: { rateLimit: { max: limit(150), timeWindow: '1 minute' } },
        schema: { params, body: sendMessageBody, response: { 201: messageSchema } },
      },
      controller.send,
    );
    app.post('/conversations/:id/read', { schema: { params, body: z.object({ upToMessageId: z.uuid() }) } }, controller.read);
    app.post('/messages/ack', { schema: { body: z.object({ messageIds: z.array(z.uuid()).min(1).max(200) }) } }, controller.ack);
    app.delete(
      '/messages/:id',
      { schema: { params, querystring: z.object({ scope: z.enum(['me', 'everyone']) }) } },
      controller.deleteMessage,
    );
  };
