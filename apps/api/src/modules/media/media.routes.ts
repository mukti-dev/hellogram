import type { FastifyInstance } from 'fastify';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

const TYPES: Record<string, string> = { jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

/** Serves locally stored avatars in development (production uses S3 + CloudFront). */
export const mediaRoutes = (rootDir: string) => async (app: FastifyInstance) => {
  app.get<{ Params: { folder: string; file: string } }>('/media/:folder/:file', async (request, reply) => {
    const { folder, file } = request.params;
    const ext = file.split('.').pop() ?? '';
    if (folder !== 'avatars' || !/^[\w-]+\.(jpg|png|webp)$/.test(file) || !TYPES[ext]) {
      return reply.status(404).send();
    }
    const path = join(rootDir, folder, file);
    try {
      await stat(path);
    } catch {
      return reply.status(404).send();
    }
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.header('Cross-Origin-Resource-Policy', 'cross-origin');
    return reply.type(TYPES[ext]).send(createReadStream(path));
  });
};
