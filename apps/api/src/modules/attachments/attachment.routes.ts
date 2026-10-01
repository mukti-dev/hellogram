import { LIMITS, attachmentSchema } from '@hellogram/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { limit } from '../../plugins/rate-limit.js';
import type { AttachmentController } from './attachment.controller.js';

const params = z.object({ id: z.uuid() });

/**
 * Chat files. There are no public or pre-signed links: the bytes only ever leave through
 * `GET /attachments/:id`, with the caller's access token, after the checks in AttachmentService.
 */
export const attachmentRoutes =
  (controller: AttachmentController): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    // The file is the raw request body; its name travels in X-File-Name (URL-encoded).
    app.addContentTypeParser(
      'application/octet-stream',
      { parseAs: 'buffer', bodyLimit: LIMITS.ATTACHMENT_MAX_BYTES },
      (_req, body, done) => done(null, body),
    );

    app.post(
      '/conversations/:id/attachments',
      {
        // Per-number limits are in AttachmentService; this is a coarse per-IP ceiling.
        config: { rateLimit: { max: limit(60), timeWindow: '10 minutes' } },
        schema: { params, response: { 201: attachmentSchema } },
      },
      controller.upload,
    );

    app.get(
      '/attachments/:id',
      { config: { rateLimit: { max: limit(600), timeWindow: '5 minutes' } }, schema: { params } },
      controller.download,
    );
  };
