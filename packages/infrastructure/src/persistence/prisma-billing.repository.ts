import { toLabelIcon } from './mappers.js';
import { Prisma } from '@hellogram/db';
import { invoiceNumber, type BillingRepository, type DraftRow, type PaymentRecord, type Subscription } from '@hellogram/domain';
import type { PrismaClient } from '@hellogram/db';

const subSelect = {
  id: true,
  accountId: true,
  provider: true,
  providerSubId: true,
  quantity: true,
  status: true,
  currentPeriodEnd: true,
  graceUntil: true,
} as const;

const draftSelect = {
  id: true,
  accountId: true,
  displayName: true,
  labelIcon: true,
  labelName: true,
  allowCalls: true,
  allowMedia: true,
} as const;

const paymentSelect = { id: true, invoiceNo: true, amountPaise: true, gstPaise: true, paidAt: true } as const;

export class PrismaBillingRepository implements BillingRepository {
  constructor(private readonly db: PrismaClient) {}

  findActiveSubscription(accountId: string): Promise<Subscription | null> {
    return this.db.subscription.findFirst({
      where: { accountId, status: { in: ['created', 'authenticated', 'active', 'past_due', 'grace'] } },
      orderBy: { createdAt: 'desc' },
      select: subSelect,
    });
  }

  findByProviderId(providerSubId: string): Promise<Subscription | null> {
    return this.db.subscription.findUnique({ where: { providerSubId }, select: subSelect });
  }

  createSubscription(input: { accountId: string; provider: string; providerSubId: string; quantity: number }): Promise<Subscription> {
    return this.db.subscription.create({ data: { ...input, status: 'created' }, select: subSelect });
  }

  async updateSubscription(id: string, patch: Partial<Pick<Subscription, 'quantity' | 'status' | 'currentPeriodEnd' | 'graceUntil'>>) {
    await this.db.subscription.update({ where: { id }, data: patch });
  }

  createDraft(input: {
    accountId: string;
    displayName: string;
    labelIcon: string;
    labelName: string;
    allowCalls: boolean;
    allowMedia: boolean;
    providerRef: string;
    expiresAt: Date;
  }) {
    return this.db.personaDraft.create({ data: input, select: { id: true } });
  }

  async openDraftsFor(providerSubId: string, now: Date): Promise<DraftRow[]> {
    const rows = await this.db.personaDraft.findMany({
      where: { providerRef: providerSubId, consumedAt: null, expiresAt: { gt: now } },
      orderBy: { expiresAt: 'asc' },
      select: draftSelect,
    });
    return rows.map((r) => ({ ...r, labelIcon: toLabelIcon(r.labelIcon) }));
  }

  async findDraft(id: string, accountId: string) {
    const row = await this.db.personaDraft.findFirst({ where: { id, accountId }, select: { ...draftSelect, consumedPersonaId: true } });
    return row && { ...row, labelIcon: toLabelIcon(row.labelIcon) };
  }

  async consumeDraft(id: string, personaId: string, at: Date): Promise<boolean> {
    const { count } = await this.db.personaDraft.updateMany({
      where: { id, consumedAt: null },
      data: { consumedAt: at, consumedPersonaId: personaId },
    });
    return count === 1;
  }

  async recordWebhook(eventId: string, provider: string, type: string, payload: unknown): Promise<boolean> {
    try {
      await this.db.webhookEvent.create({
        data: { id: eventId, provider, type, payload: payload as Prisma.InputJsonValue, processedAt: new Date() },
      });
      return true;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  async addPayment(input: { subscriptionId: string; amountPaise: number; gstPaise: number; providerPaymentId: string; paidAt: Date }) {
    const existing = await this.db.payment.findUnique({ where: { providerPaymentId: input.providerPaymentId }, select: paymentSelect });
    if (existing) return null;
    const [row] = await this.db.$queryRaw<{ nextval: bigint }[]>`SELECT nextval('invoice_seq')`;
    return this.db.payment.create({
      data: { ...input, invoiceNo: invoiceNumber(Number(row?.nextval ?? 0), input.paidAt) },
      select: paymentSelect,
    });
  }

  listPayments(accountId: string): Promise<PaymentRecord[]> {
    return this.db.payment.findMany({
      where: { subscription: { accountId } },
      orderBy: { paidAt: 'desc' },
      select: paymentSelect,
    });
  }

  findPayment(id: string, accountId: string): Promise<PaymentRecord | null> {
    return this.db.payment.findFirst({ where: { id, subscription: { accountId } }, select: paymentSelect });
  }

  graceExpired(now: Date): Promise<Subscription[]> {
    return this.db.subscription.findMany({ where: { status: 'grace', graceUntil: { lte: now } }, select: subSelect });
  }

  inGrace(): Promise<Subscription[]> {
    return this.db.subscription.findMany({ where: { status: 'grace' }, select: subSelect });
  }
}
