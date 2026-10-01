import { AVATAR_MAX_BYTES } from '@hellogram/application';
import {
  createPersonaBody,
  ownPersonaSchema,
  personaListSchema,
  retirePersonaBody,
  shareSchema,
  updatePersonaBody,
} from '@hellogram/shared';
import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { PersonaController } from './persona.controller.js';

const params = z.object({ id: z.uuid() });

export const personaRoutes =
  (controller: PersonaController): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    // Raw image bodies for avatar upload.
    app.addContentTypeParser(
      ['image/jpeg', 'image/png', 'image/webp'],
      { parseAs: 'buffer', bodyLimit: AVATAR_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    app.get('/personas', { schema: { response: { 200: personaListSchema } } }, controller.list);
    app.post(
      '/personas',
      {
        config: { rateLimit: { max: limit(20), timeWindow: '1 hour' } },
        // 402 carries either { checkout } (billing enabled) or the standard error body, so it isn't schema-bound.
        schema: { body: createPersonaBody, response: { 201: ownPersonaSchema } },
      },
      controller.create,
    );
    app.get('/personas/:id', { schema: { params, response: { 200: ownPersonaSchema } } }, controller.get);
    app.patch(
      '/personas/:id',
      { schema: { params, body: updatePersonaBody, response: { 200: ownPersonaSchema } } },
      controller.update,
    );
    app.post('/personas/:id/pause', { schema: { params, response: { 200: ownPersonaSchema } } }, controller.pause);
    app.post('/personas/:id/resume', { schema: { params, response: { 200: ownPersonaSchema } } }, controller.resume);
    app.delete('/personas/:id', { schema: { params, body: retirePersonaBody } }, controller.retire);
    app.get('/personas/:id/share', { schema: { params, response: { 200: shareSchema } } }, controller.share);
    app.put(
      '/personas/:id/avatar',
      { config: { rateLimit: { max: limit(20), timeWindow: '1 hour' } }, schema: { params, response: { 200: ownPersonaSchema } } },
      controller.uploadAvatar,
    );
    app.delete('/personas/:id/avatar', { schema: { params, response: { 200: ownPersonaSchema } } }, controller.removeAvatar);
  };
