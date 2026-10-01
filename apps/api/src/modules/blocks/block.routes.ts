import type { BlockService } from '@hellogram/application';
import { blockSchema } from '@hellogram/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';

/** Settings → Blocked. Shown by the codes involved (rule 16). */
export const blockRoutes =
  (blocks: BlockService): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get('/blocks', { schema: { response: { 200: z.object({ items: z.array(blockSchema) }) } } }, async (request) => {
      const records = await blocks.list(actorOf(request));
      return {
        items: records.map((b) => ({
          id: b.id,
          blockedCode: b.blockedPersonaCode,
          blockedDisplayName: b.blockedDisplayName,
          fromCode: b.blockerPersonaCode,
          createdAt: b.createdAt.toISOString(),
        })),
      };
    });

    app.delete('/blocks/:id', { schema: { params: z.object({ id: z.uuid() }) } }, async (request, reply) => {
      await blocks.unblock(actorOf(request), request.params.id);
      return reply.status(204).send();
    });
  };
