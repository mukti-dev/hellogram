import { Button, Card, ProgressBar } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowLeft, Crown, FileText } from 'lucide-react';
import { Link, useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { useNumbers } from '../../numbers/model/queries.js';
import { billingApi, rupees } from '../api.js';

const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

/** Settings → Billing: plan, subscription status and GST invoices. */
export function BillingPage() {
  const navigate = useNavigate();
  const client = useQueryClient();
  const billing = useQuery({ queryKey: ['billing'], queryFn: billingApi.summary });
  const plan = useNumbers().data?.plan;
  const sub = billing.data?.subscription;
  const fail = useMutation({
    mutationFn: billingApi.devFail,
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['billing'] });
      void client.invalidateQueries({ queryKey: ['personas'] });
    },
  });

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
      <div className="flex items-center gap-2">
        <button type="button" onClick={() => navigate('/settings')} aria-label={t('numbers.back')} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-2xl font-bold tracking-tight">{t('billing.title')}</h1>
      </div>

      {plan && (
        <Card className="mt-4 p-4">
          <div className="flex items-center gap-3">
            <span className="inline-flex size-11 items-center justify-center rounded-md bg-label-olx/15">
              <Crown className="size-5 text-label-olx" aria-hidden />
            </span>
            <div>
              <p className="font-semibold">{t('plan.numbersUsed', { used: plan.used, max: plan.max })}</p>
              <p className="text-sm text-muted">{t('plan.freePaid', { free: plan.free, paid: plan.paid })}</p>
            </div>
          </div>
          <ProgressBar value={plan.used} max={plan.max} label={t('plan.usage')} className="mt-3" />
          <p className="mt-3 text-sm text-muted">{t('billing.pricing')}</p>
        </Card>
      )}

      {sub?.status === 'grace' && sub.graceUntil && (
        <Card className="mt-4 flex gap-3 border-danger/40 bg-danger/10 p-4" role="alert">
          <AlertTriangle className="size-5 shrink-0 text-danger" aria-hidden />
          <div className="text-sm">
            <p className="font-semibold">{t('billing.graceTitle')}</p>
            <p className="text-muted">{t('billing.graceBody', { date: date(sub.graceUntil) })}</p>
          </div>
        </Card>
      )}

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold">{t('billing.subscription')}</h2>
        {sub ? (
          <dl className="mt-2 grid grid-cols-2 gap-y-2 text-sm">
            <dt className="text-muted">{t('billing.status')}</dt>
            <dd className="font-medium capitalize">{sub.status}</dd>
            <dt className="text-muted">{t('billing.paidNumbers')}</dt>
            <dd className="font-medium">{sub.quantity}</dd>
            <dt className="text-muted">{t('billing.monthly')}</dt>
            <dd className="font-medium">{rupees(sub.monthlyAmountPaise)}</dd>
            {sub.currentPeriodEnd && (
              <>
                <dt className="text-muted">{t('billing.renews')}</dt>
                <dd className="font-medium">{date(sub.currentPeriodEnd)}</dd>
              </>
            )}
            <dt className="text-muted">{t('billing.method')}</dt>
            <dd className="font-medium">{sub.provider === 'dev' ? t('billing.simulator') : 'UPI Autopay / card (Razorpay)'}</dd>
          </dl>
        ) : (
          <p className="mt-2 text-sm text-muted">{t('billing.noSubscription')}</p>
        )}
        {billing.data?.devTools && sub?.status === 'active' && (
          <Button variant="outline" size="sm" className="mt-4" disabled={fail.isPending} onClick={() => fail.mutate()}>
            {t('billing.simFail')}
          </Button>
        )}
      </Card>

      <Card className="mt-4 p-4">
        <h2 className="text-sm font-semibold">{t('billing.invoices')}</h2>
        {billing.data?.invoices.length === 0 && <p className="mt-2 text-sm text-muted">{t('billing.noInvoices')}</p>}
        <ul className="mt-2 divide-y divide-border">
          {billing.data?.invoices.map((inv) => (
            <li key={inv.id}>
              <Link to={`/settings/billing/invoices/${inv.id}`} className="flex items-center gap-3 py-3 hover:text-primary">
                <FileText className="size-5 text-muted" aria-hidden />
                <span className="flex-1">
                  <span className="block font-mono text-sm">{inv.invoiceNo}</span>
                  <span className="block text-xs text-muted">{date(inv.paidAt)}</span>
                </span>
                <span className="text-sm font-semibold">{rupees(inv.amountPaise)}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
