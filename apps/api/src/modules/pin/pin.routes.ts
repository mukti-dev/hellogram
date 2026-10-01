import type { PinService } from '@hellogram/application';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';
import { limit } from '../../plugins/rate-limit.js';
import { toProof, withProof } from '../shared-proof.js';

const params = z.object({ id: z.uuid() });
const pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');
const unlockResponse = z.object({ unlockToken: z.string(), expiresIn: z.number().int() });

export const pinRoutes =
  (pins: PinService): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.put(
      '/personas/:id/pin',
      { schema: { params, body: z.object({ pin, currentPin: pin.optional() }), response: { 200: unlockResponse } } },
      async (request) => pins.setPin(actorOf(request), request.params.id, request.body.pin, request.body.currentPin),
    );

    app.delete('/personas/:id/pin', { schema: { params, body: z.object({ pin }) } }, async (request, reply) => {
      await pins.removePin(actorOf(request), request.params.id, request.body.pin);
      return reply.status(204).send();
    });

    app.post(
      '/personas/:id/unlock',
      {
        config: { rateLimit: { max: limit(30), timeWindow: '15 minutes' } },
        schema: { params, body: z.object({ pin }), response: { 200: unlockResponse } },
      },
      async (request) => pins.unlock(actorOf(request), request.params.id, request.body.pin),
    );

    app.post(
      '/personas/:id/pin/reset/otp',
      { config: { rateLimit: { max: limit(10), timeWindow: '1 hour' } }, schema: { params } },
      async (request, reply) => {
        await pins.sendResetOtp(actorOf(request), request.params.id, request.ip);
        return reply.status(204).send();
      },
    );

    app.post(
      '/personas/:id/pin/reset',
      {
        config: { rateLimit: { max: limit(20), timeWindow: '15 minutes' } },
        schema: { params, body: withProof(z.object({ newPin: pin })), response: { 200: unlockResponse } },
      },
      async (request) => pins.resetPin(actorOf(request), request.params.id, toProof(request.body), request.body.newPin),
    );
  };
