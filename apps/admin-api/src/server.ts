import { pino } from 'pino';
import { buildAdminApp } from './app.js';
import { createAdminContainer } from './container.js';
import { loadAdminEnv } from './env.js';

async function main() {
  const env = loadAdminEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    redact: { paths: ['req.headers.authorization', '*.password', '*.code', '*.token'], censor: '[redacted]' },
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
  const container = createAdminContainer(env);
  const app = await buildAdminApp({ container, jwtSecret: env.ADMIN_JWT_SECRET, corsOrigins: env.ADMIN_CORS_ORIGINS, logger, trustProxy: env.TRUST_PROXY });
  app.addHook('onClose', async () => container.close());
  process.once('SIGTERM', () => void app.close().then(() => process.exit(0)));
  process.once('SIGINT', () => void app.close().then(() => process.exit(0)));
  await app.listen({ port: env.PORT, host: env.HOST });
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
