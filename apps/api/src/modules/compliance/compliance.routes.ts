import type { ComplianceService } from '@hellogram/application';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';
import { limit } from '../../plugins/rate-limit.js';
import { toProof, withProof } from '../shared-proof.js';

const phoneChange = z.object({ id: z.uuid(), newPhone: z.string(), effectiveAt: z.string() });

/** DPDP access/erasure and phone change (signed in). */
export const complianceRoutes =
  (compliance: ComplianceService): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get('/me/export', { config: { rateLimit: { max: limit(5), timeWindow: '1 hour' } } }, async (request, reply) => {
      const data = await compliance.exportData(actorOf(request));
      return reply
        .header('Content-Disposition', `attachment; filename="hellogram-data-${new Date().toISOString().slice(0, 10)}.json"`)
        .type('application/json')
        .send(JSON.stringify(data, null, 2));
    });

    app.post('/me/delete/otp', { config: { rateLimit: { max: limit(5), timeWindow: '1 hour' } } }, async (request, reply) => {
      await compliance.sendDeletionOtp(actorOf(request), request.ip);
      return reply.status(204).send();
    });

    app.delete('/me', { schema: { body: withProof(z.object({ confirm: z.literal('DELETE') })) } }, async (request, reply) => {
      await compliance.deleteAccount(actorOf(request), toProof(request.body));
      return reply.clearCookie('hg_rt', { path: '/v1/auth' }).status(204).send();
    });

    app.get('/me/phone-change', { schema: { response: { 200: z.object({ pending: phoneChange.nullable() }) } } }, async (request) => {
      const pending = await compliance.pendingPhoneChange(actorOf(request));
      return { pending: pending && { id: pending.id, newPhone: pending.newPhone, effectiveAt: pending.effectiveAt.toISOString() } };
    });

    app.post(
      '/me/phone-change',
      { config: { rateLimit: { max: limit(5), timeWindow: '1 hour' } }, schema: { body: z.object({ newPhone: z.string().max(20) }) } },
      async (request, reply) => {
        await compliance.startPhoneChange(actorOf(request), request.body.newPhone, request.ip);
        return reply.status(204).send();
      },
    );

    app.post(
      '/me/phone-change/verify',
      { schema: { body: withProof(z.object({ newPhone: z.string().max(20) })), response: { 200: phoneChange } } },
      async (request) => {
        const change = await compliance.confirmPhoneChange(actorOf(request), request.body.newPhone, toProof(request.body));
        return { id: change.id, newPhone: change.newPhone, effectiveAt: change.effectiveAt.toISOString() };
      },
    );

    app.delete('/me/phone-change', async (request, reply) => {
      await compliance.cancelPhoneChange(actorOf(request));
      return reply.status(204).send();
    });
  };

/** Public: grievance form + Grievance Officer details (IT Rules 2021). */
export const grievanceRoutes =
  (compliance: ComplianceService, officer: { name: string; email: string }): FastifyPluginAsyncZod =>
  async (app) => {
    app.get('/legal/grievance-officer', async () => officer);
    app.post(
      '/grievance',
      {
        config: { rateLimit: { max: limit(5), timeWindow: '1 hour' } },
        preHandler: app.requireHuman,
        schema: {
          body: z.object({
            turnstileToken: z.string().max(4096).optional(),
            contact: z.string().trim().min(3).max(200),
            subject: z.string().trim().min(3).max(200),
            body: z.string().trim().min(10).max(5000),
          }),
        },
      },
      async (request, reply) => {
        const { contact, subject, body } = request.body;
        const ticket = await compliance.submitGrievance({ contact, subject, body });
        return reply.status(201).send({ id: ticket.id, ackDueAt: ticket.ackDueAt.toISOString(), resolveDueAt: ticket.resolveDueAt.toISOString() });
      },
    );
  };
