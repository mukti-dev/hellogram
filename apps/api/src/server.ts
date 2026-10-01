import { buildApp } from './app.js';
import { loadApiEnv } from './config/env.js';
import { createLogger } from './config/logger.js';
import { createContainer } from './container.js';
import { callSocketHandlers } from './realtime/call-handlers.js';
import { chatSocketHandlers } from './realtime/chat-handlers.js';
import { attachRealtime } from './realtime/gateway.js';
import { registerPushBridge } from './realtime/push-bridge.js';
import { setRateLimitMultiplier } from './plugins/rate-limit.js';

async function main(): Promise<void> {
  const env = loadApiEnv();
  setRateLimitMultiplier(env.RATE_LIMIT_MULTIPLIER);
  const logger = createLogger(env);
  const container = createContainer(env, logger);
  const app = await buildApp({ container, corsOrigins: env.CORS_ORIGINS, logger });

  if (container.redis) {
    const rt = attachRealtime(app, {
      corsOrigins: env.CORS_ORIGINS,
      redis: container.redis,
      authService: container.authService,
      personaService: container.personaService,
      events: container.events,
      avatarUrl: container.avatarUrl,
      onConnection: [chatSocketHandlers(container.chatService), callSocketHandlers(container.callService)],
    });
    if (container.notificationQueue) {
      registerPushBridge(rt, container.events, container.pushTriggers, container.notificationQueue);
    }
  }
  app.addHook('onClose', async () => container.close());

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down');
    await app.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
