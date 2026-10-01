import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { AdminActor } from '@hellogram/domain';
import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import { toTrustProxy } from '@hellogram/config';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import { hasZodFastifySchemaValidationErrors, serializerCompiler, validatorCompiler, type ZodTypeProvider } from 'fastify-type-provider-zod';
import { SignJWT, jwtVerify } from 'jose';
import type { Logger } from 'pino';
import { z } from 'zod';
import type { AdminContainer } from './container.js';

const STATUS: Partial<Record<string, number>> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
};

const reportStatus = z.enum(['open', 'reviewing', 'actioned', 'dismissed']);
const grievanceStatus = z.enum(['open', 'acknowledged', 'resolved', 'closed']);

/**
 * Admin API (separate process, private domain). Bearer JWT from email + password + TOTP.
 * Role checks and audit logging live in AdminService.
 */
export async function buildAdminApp(opts: {
  container: AdminContainer;
  jwtSecret: string;
  corsOrigins: string[];
  logger?: Logger;
  trustProxy?: boolean | number | string[];
}): Promise<FastifyInstance> {
  const key = new TextEncoder().encode(opts.jwtSecret);
  const app = Fastify({ ...(opts.logger ? { loggerInstance: opts.logger } : { logger: false }), trustProxy: toTrustProxy(opts.trustProxy) }).withTypeProvider<ZodTypeProvider>();
  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  app.setErrorHandler((error: Error & { statusCode?: number }, request, reply) => {
    if (error instanceof DomainError) {
      return reply.status(STATUS[error.code] ?? 400).send({ error: { code: error.code, message: error.message } });
    }
    if (hasZodFastifySchemaValidationErrors(error)) {
      return reply.status(400).send({ error: { code: ErrorCode.VALIDATION_FAILED, message: 'Request validation failed' } });
    }
    if (error.statusCode === 429) return reply.status(429).send({ error: { code: ErrorCode.RATE_LIMITED, message: 'Too many requests' } });
    request.log.error({ err: error }, 'admin error');
    return reply.status(500).send({ error: { code: ErrorCode.INTERNAL, message: 'Something went wrong' } });
  });

  await app.register(helmet, { contentSecurityPolicy: { directives: { defaultSrc: ["'none'"] } } });
  await app.register(cors, { origin: opts.corsOrigins, methods: ['GET', 'POST', 'PATCH'] });
  await app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });

  const admins = opts.container.adminService;

  const actorOf = async (request: FastifyRequest): Promise<AdminActor> => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in');
    try {
      const { payload } = await jwtVerify(header.slice(7), key, { issuer: 'hellogram-admin', algorithms: ['HS256'] });
      // Role and disabled state come from the database, so demotions apply at once.
      const me = await admins.me({ adminId: String(payload.sub), role: payload['role'] as AdminActor['role'] });
      return { adminId: me.id, role: me.role };
    } catch (error) {
      if (error instanceof DomainError) throw error;
      throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in');
    }
  };

  await app.register(
    async (scope) => {
      const r = scope.withTypeProvider<ZodTypeProvider>();
      r.post(
        '/auth/login',
        {
          config: { rateLimit: { max: 10, timeWindow: '15 minutes' } },
          schema: { body: z.object({ email: z.email(), password: z.string().min(1).max(200), code: z.string().max(10) }) },
        },
        async (request) => {
          const actor = await admins.login(request.body.email, request.body.password, request.body.code);
          const token = await new SignJWT({ role: actor.role })
            .setProtectedHeader({ alg: 'HS256' })
            .setSubject(actor.adminId)
            .setIssuer('hellogram-admin')
            .setIssuedAt()
            .setExpirationTime('8h')
            .sign(key);
          return { token, role: actor.role };
        },
      );

      r.get('/me', async (request) => admins.me(await actorOf(request)));
      r.get('/stats', async (request) => admins.stats(await actorOf(request)));

      r.get('/reports', { schema: { querystring: z.object({ status: reportStatus.optional() }) } }, async (request) =>
        admins.reports(await actorOf(request), request.query.status),
      );
      r.get('/reports/:id', { schema: { params: z.object({ id: z.uuid() }) } }, async (request) =>
        admins.report(await actorOf(request), request.params.id),
      );
      r.patch('/reports/:id', { schema: { params: z.object({ id: z.uuid() }), body: z.object({ status: reportStatus }) } }, async (request, reply) => {
        await admins.setReportStatus(await actorOf(request), request.params.id, request.body.status);
        return reply.status(204).send();
      });

      r.get('/lookup', { schema: { querystring: z.object({ code: z.string().max(12).optional(), accountId: z.uuid().optional() }) } }, async (request) =>
        admins.lookup(await actorOf(request), request.query),
      );
      r.post(
        '/accounts/:id/actions',
        {
          schema: {
            params: z.object({ id: z.uuid() }),
            body: z.object({
              action: z.enum(['warn', 'suspend', 'unsuspend', 'ban', 'unban']),
              reason: z.string().min(3).max(500),
              untilHours: z.number().int().positive().max(24 * 365).optional(),
              reportId: z.uuid().optional(),
            }),
          },
        },
        async (request, reply) => {
          await admins.accountAction(await actorOf(request), { accountId: request.params.id, ...request.body });
          return reply.status(204).send();
        },
      );

      r.get('/audit', { schema: { querystring: z.object({ before: z.iso.datetime().optional() }) } }, async (request) =>
        admins.auditLog(await actorOf(request), request.query.before ? new Date(request.query.before) : undefined),
      );

      r.get('/grievances', { schema: { querystring: z.object({ status: grievanceStatus.optional() }) } }, async (request) =>
        admins.grievances(await actorOf(request), request.query.status),
      );
      r.patch('/grievances/:id', { schema: { params: z.object({ id: z.uuid() }), body: z.object({ status: grievanceStatus }) } }, async (request) =>
        admins.setGrievanceStatus(await actorOf(request), request.params.id, request.body.status),
      );

      r.get('/legal-requests', async (request) => admins.legalRequests(await actorOf(request)));
      r.post(
        '/legal-requests',
        {
          schema: {
            body: z.object({
              authority: z.string().min(2).max(200),
              referenceNo: z.string().min(1).max(100),
              scope: z.string().min(2).max(2000),
              receivedAt: z.iso.datetime(),
              notes: z.string().max(5000).nullish(),
            }),
          },
        },
        async (request, reply) =>
          reply.status(201).send(
            await admins.createLegalRequest(await actorOf(request), { ...request.body, receivedAt: new Date(request.body.receivedAt) }),
          ),
      );
      r.patch(
        '/legal-requests/:id',
        { schema: { params: z.object({ id: z.uuid() }), body: z.object({ respondedAt: z.iso.datetime().nullable().optional(), notes: z.string().max(5000).nullable().optional() }) } },
        async (request, reply) => {
          const { respondedAt, notes } = request.body;
          await admins.updateLegalRequest(await actorOf(request), request.params.id, {
            ...(respondedAt !== undefined ? { respondedAt: respondedAt ? new Date(respondedAt) : null } : {}),
            ...(notes !== undefined ? { notes } : {}),
          });
          return reply.status(204).send();
        },
      );
    },
    { prefix: '/admin/v1' },
  );

  app.get('/health/live', async () => ({ status: 'ok' }));
  return app as unknown as FastifyInstance;
}
