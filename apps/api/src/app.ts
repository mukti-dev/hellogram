import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import { toTrustProxy } from '@hellogram/config';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import {
  serializerCompiler,
  validatorCompiler,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type { AppContainer } from './container.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { HealthController } from './modules/health/health.controller.js';
import { healthRoutes } from './modules/health/health.routes.js';
import { mediaRoutes } from './modules/media/media.routes.js';
import { MeController } from './modules/me/me.controller.js';
import { billingRoutes, billingWebhookRoute } from './modules/billing/billing.routes.js';
import { blockRoutes } from './modules/blocks/block.routes.js';
import { pushRoutes } from './modules/push/push.routes.js';
import { callRoutes } from './modules/calls/call.routes.js';
import { ChatController } from './modules/chat/chat.controller.js';
import { complianceRoutes, grievanceRoutes } from './modules/compliance/compliance.routes.js';
import { chatRoutes } from './modules/chat/chat.routes.js';
import { PersonaController } from './modules/personas/persona.controller.js';
import { publicRoutes } from './modules/public/public.routes.js';
import { RequestController } from './modules/requests/request.controller.js';
import { requestRoutes } from './modules/requests/request.routes.js';
import { pinRoutes } from './modules/pin/pin.routes.js';
import { safetyRoutes } from './modules/safety/safety.routes.js';
import { personaRoutes } from './modules/personas/persona.routes.js';
import { meRoutes } from './modules/me/me.routes.js';
import { authPlugin } from './plugins/auth.js';
import { errorHandlerPlugin } from './plugins/error-handler.js';
import { rateLimitPlugin } from './plugins/rate-limit.js';
import { securityPlugin } from './plugins/security.js';

export interface BuildAppOptions {
  container: AppContainer;
  corsOrigins: string[];
  logger?: Logger;
}

/** Builds the Fastify app without listening, so tests can use `app.inject()`. */
export async function buildApp({ container, corsOrigins, logger }: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({
    ...(logger ? { loggerInstance: logger } : { logger: false }),
    // Never "true": trusting every hop lets clients forge X-Forwarded-For and dodge per-IP limits.
    trustProxy: toTrustProxy(container.trustProxy),
    bodyLimit: 64 * 1024,
    genReqId: (req) => {
      const incoming = req.headers['x-request-id'];
      return typeof incoming === 'string' && incoming.length <= 64 ? incoming : randomUUID();
    },
  }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(errorHandlerPlugin);
  await app.register(securityPlugin, { corsOrigins });
  await app.register(rateLimitPlugin, container.redis ? { redis: container.redis } : {});
  // Bot check (Cloudflare Turnstile) for OTP sends and grievances; a no-op when not configured (dev).
  app.decorate('requireHuman', async (request: FastifyRequest) => {
    if (!container.turnstile) return;
    const token = (request.body as { turnstileToken?: string } | undefined)?.turnstileToken;
    if (!(await container.turnstile.verify(token, request.ip))) {
      throw new DomainError(ErrorCode.FORBIDDEN, 'Please complete the security check');
    }
  });
  await app.register(authPlugin, {
    authService: container.authService,
    ...(container.pinService ? { pinService: container.pinService } : {}),
  });

  // Health checks live outside /v1 so load balancers don't depend on API versioning.
  await app.register(healthRoutes(new HealthController(container.healthService)));
  if (container.mediaDir) await app.register(mediaRoutes(container.mediaDir));

  await app.register(
    async (v1) => {
      v1.get('/', async () => ({ name: 'hellogram-api', version: 'v1' }));
      await v1.register(authRoutes(new AuthController(container.authService, container.cookie), container.phoneAuthProvider));
      await v1.register(meRoutes(new MeController(container.accountService)));
      await v1.register(personaRoutes(new PersonaController(container.personaService)));
      await v1.register(publicRoutes(container.requestService, container.avatarUrl));
      await v1.register(requestRoutes(new RequestController(container.requestService, container.avatarUrl)));
      await v1.register(blockRoutes(container.blockService));
      await v1.register(chatRoutes(new ChatController(container.chatService, container.avatarUrl)));
      await v1.register(safetyRoutes(container.safetyService));
      await v1.register(pinRoutes(container.pinService));
      await v1.register(callRoutes(container.callService, container.avatarUrl));
      await v1.register(billingRoutes(container.billingService, container.billingDevTools));
      await v1.register(billingWebhookRoute(container.billingService));
      await v1.register(pushRoutes(container.notificationService, container.vapidPublicKey));
      await v1.register(complianceRoutes(container.complianceService));
      await v1.register(grievanceRoutes(container.complianceService, container.grievanceOfficer));
    },
    { prefix: '/v1' },
  );

  return app as unknown as FastifyInstance;
}
