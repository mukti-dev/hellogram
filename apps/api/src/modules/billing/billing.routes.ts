import type { BillingService } from '@hellogram/application';
import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { FastifyPluginAsyncZod } from 'fastify-type-provider-zod';
import { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';

const invoiceSchema = z.object({
  id: z.uuid(),
  invoiceNo: z.string(),
  amountPaise: z.number().int(),
  gstPaise: z.number().int(),
  paidAt: z.string(),
});

const toInvoice = (p: { id: string; invoiceNo: string; amountPaise: number; gstPaise: number; paidAt: Date }) => ({
  ...p,
  paidAt: p.paidAt.toISOString(),
});

export const billingRoutes =
  (billing: BillingService, devTools: boolean): FastifyPluginAsyncZod =>
  async (app) => {
    app.addHook('preHandler', app.requireAuth);

    app.get(
      '/billing',
      {
        schema: {
          response: {
            200: z.object({
              subscription: z
                .object({
                  status: z.string(),
                  quantity: z.number().int(),
                  monthlyAmountPaise: z.number().int(),
                  currentPeriodEnd: z.string().nullable(),
                  graceUntil: z.string().nullable(),
                  provider: z.string(),
                })
                .nullable(),
              invoices: z.array(invoiceSchema),
              devTools: z.boolean(),
            }),
          },
        },
      },
      async (request) => {
        const { subscription: s, invoices } = await billing.summary(actorOf(request));
        return {
          subscription: s && {
            status: s.status,
            quantity: s.quantity,
            monthlyAmountPaise: s.monthlyAmountPaise,
            currentPeriodEnd: s.currentPeriodEnd?.toISOString() ?? null,
            graceUntil: s.graceUntil?.toISOString() ?? null,
            provider: s.provider,
          },
          invoices: invoices.map(toInvoice),
          devTools,
        };
      },
    );

    app.get('/billing/invoices/:id', { schema: { params: z.object({ id: z.uuid() }), response: { 200: invoiceSchema } } }, async (request) => {
      const invoice = await billing.invoice(actorOf(request), request.params.id);
      if (!invoice) throw new DomainError(ErrorCode.NOT_FOUND, 'Invoice not found');
      return toInvoice(invoice);
    });

    app.get(
      '/billing/drafts/:id',
      { schema: { params: z.object({ id: z.uuid() }), response: { 200: z.object({ personaId: z.uuid().nullable() }) } } },
      async (request) => billing.draftStatus(actorOf(request), request.params.id),
    );

    if (devTools) {
      app.post(
        '/billing/dev/confirm',
        { schema: { body: z.object({ draftId: z.uuid() }), response: { 200: z.object({ personaId: z.uuid().nullable() }) } } },
        async (request) => billing.devConfirm(actorOf(request), request.body.draftId),
      );
      app.post('/billing/dev/fail', async (request, reply) => {
        await billing.devFail(actorOf(request));
        return reply.status(204).send();
      });
    }
  };

/** Razorpay webhook: raw body for signature verification, no user auth. */
export const billingWebhookRoute =
  (billing: BillingService): FastifyPluginAsync =>
  async (app) => {
    app.removeAllContentTypeParsers();
    app.addContentTypeParser('*', { parseAs: 'string', bodyLimit: 256 * 1024 }, (_req, body, done) => done(null, body));
    app.post('/billing/webhook', async (request, reply) => {
      const signature = request.headers['x-razorpay-signature'];
      await billing.handleWebhook(String(request.body ?? ''), typeof signature === 'string' ? signature : undefined);
      return reply.status(200).send({ ok: true });
    });
  };
