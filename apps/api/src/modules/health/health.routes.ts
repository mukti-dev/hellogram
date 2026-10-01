import { healthResponseSchema } from '@hellogram/shared';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import type { HealthController } from './health.controller.js';

export const healthRoutes =
  (controller: HealthController): FastifyPluginAsyncZod =>
  async (app) => {
    app.get(
      '/health/live',
      { schema: { response: { 200: z.object({ status: z.literal('ok') }) } } },
      controller.live,
    );
    app.get(
      '/health/ready',
      { schema: { response: { 200: healthResponseSchema, 503: healthResponseSchema } } },
      controller.ready,
    );
  };
