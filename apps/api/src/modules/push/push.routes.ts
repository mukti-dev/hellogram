import type { NotificationService } from '@hellogram/application';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';

/** Browser push services only: the worker POSTs to this URL, so anything else would be an SSRF. */
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /(^|\.)push\.apple\.com$/, /(^|\.)notify\.windows\.com$/];
const pushEndpoint = z
  .url()
  .max(1000)
  .refine((value) => {
    const url = new URL(value);
    return url.protocol === 'https:' && PUSH_HOSTS.some((h) => h.test(url.hostname));
  }, 'Unsupported push service');

const subscription = z.object({
  endpoint: pushEndpoint,
  keys: z.object({ p256dh: z.string().max(200), auth: z.string().max(100) }),
});

/** APNs device tokens are 64 hex chars; FCM tokens are longer opaque strings. */
const nativeTokenValue = z.string().min(32).max(4096).regex(/^[\w:.-]+$/, 'Invalid push token');
const nativeToken = z
  .object({ platform: z.enum(['ios', 'android']), kind: z.enum(['voip', 'alert']), token: nativeTokenValue })
  .refine((b) => b.platform === 'ios' || b.kind === 'alert', 'Android uses one FCM token (kind "alert")');

export const pushRoutes =
  (notifications: NotificationService, publicKey: string | undefined): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get('/push/key', { schema: { response: { 200: z.object({ publicKey: z.string().nullable() }) } } }, async () => ({
      publicKey: publicKey ?? null,
    }));

    app.post('/push/subscribe', { schema: { body: subscription } }, async (request, reply) => {
      const actor = actorOf(request);
      await notifications.subscribe({
        accountId: actor.accountId,
        sessionId: actor.sessionId,
        endpoint: request.body.endpoint,
        p256dh: request.body.keys.p256dh,
        auth: request.body.keys.auth,
      });
      return reply.status(204).send();
    });

    app.delete('/push/subscribe', { schema: { body: z.object({ endpoint: pushEndpoint }) } }, async (request, reply) => {
      await notifications.unsubscribe(actorOf(request).accountId, request.body.endpoint);
      return reply.status(204).send();
    });

    // The mobile app's APNs / FCM tokens, tied to this session (logging out stops them).
    app.post('/push/native', { schema: { body: nativeToken } }, async (request, reply) => {
      const actor = actorOf(request);
      await notifications.registerNative({ accountId: actor.accountId, sessionId: actor.sessionId, ...request.body });
      return reply.status(204).send();
    });

    app.delete('/push/native', { schema: { body: z.object({ token: nativeTokenValue }) } }, async (request, reply) => {
      await notifications.unregisterNative(actorOf(request).accountId, request.body.token);
      return reply.status(204).send();
    });
  };
