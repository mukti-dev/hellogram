import type { VaultService, VaultToken } from '@hellogram/application';
import {
  moveToVaultBody,
  setLockPinBody,
  vaultOpenBody,
  vaultPinSchema,
  vaultResetTargetSchema,
  vaultSummarySchema,
  vaultTokenSchema,
} from '@hellogram/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';
import { limit } from '../../plugins/rate-limit.js';
import { toProof, withProof } from '../shared-proof.js';

const params = z.object({ id: z.uuid() });
const toDto = (t: VaultToken) => ({ token: t.token, expiresAt: t.expiresAt.toISOString() });
const pinLimit = { rateLimit: { max: limit(30), timeWindow: '15 minutes' } };

/** Chat vault: archive, lock and hide chats (this side only). */
export const vaultRoutes =
  (vault: VaultService): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get('/vault', { schema: { response: { 200: vaultSummarySchema } } }, async (request) => vault.summary(actorOf(request)));

    app.put('/vault/lock-pin', { config: pinLimit, schema: { body: setLockPinBody } }, async (request, reply) => {
      await vault.setLockPin(actorOf(request), request.body.pin, request.body.currentPin);
      return reply.status(204).send();
    });

    app.post('/conversations/:id/vault', { config: pinLimit, schema: { params, body: moveToVaultBody } }, async (request, reply) => {
      const { to, pin, newSpace } = request.body;
      await vault.move(actorOf(request), request.params.id, to, pin, newSpace);
      return reply.status(204).send();
    });

    app.post(
      '/conversations/:id/unlock',
      { config: pinLimit, schema: { params, body: vaultOpenBody, response: { 200: vaultTokenSchema } } },
      async (request) => toDto(await vault.openChat(actorOf(request), request.params.id, request.body.pin, request.body.duration)),
    );

    app.post(
      '/vault/reveal',
      { config: pinLimit, schema: { body: vaultOpenBody, response: { 200: vaultTokenSchema } } },
      async (request) => toDto(await vault.reveal(actorOf(request), request.body.pin, request.body.duration)),
    );

    app.post('/vault/reset/otp', { config: { rateLimit: { max: limit(10), timeWindow: '1 hour' } } }, async (request, reply) => {
      await vault.sendResetOtp(actorOf(request), request.ip);
      return reply.status(204).send();
    });

    app.post(
      '/vault/reset',
      {
        config: { rateLimit: { max: limit(20), timeWindow: '15 minutes' } },
        schema: { body: withProof(z.object({ target: vaultResetTargetSchema, newPin: vaultPinSchema.optional() })) },
      },
      async (request, reply) => {
        await vault.reset(actorOf(request), toProof(request.body), request.body.target, request.body.newPin);
        return reply.status(204).send();
      },
    );
  };
