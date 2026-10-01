import type { RequestService } from '@hellogram/application';
import { publicCardSchema } from '@hellogram/shared';
import { limit } from '../../plugins/rate-limit.js';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { AvatarUrl } from '../shared-mappers.js';

/** Unauthenticated public number card. 60/min per IP and a generic 404 (anti-enumeration). */
export const publicRoutes =
  (requests: RequestService, avatarUrl: AvatarUrl): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/public/numbers/:code',
      {
        config: { rateLimit: { max: limit(60), timeWindow: '1 minute' } },
        schema: { params: z.object({ code: z.string().max(12) }), response: { 200: publicCardSchema } },
      },
      async (request) => {
        const card = await requests.publicCard(request.params.code);
        return {
          code: card.code,
          displayName: card.displayName,
          avatarUrl: avatarUrl(card.avatarKey),
          acceptsRequests: card.acceptsRequests,
        };
      },
    );
  };
