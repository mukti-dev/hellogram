import { Button, Logo } from '@hellogram/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { useNavigate, useParams } from 'react-router';
import { t } from '../../../i18n/t.js';
import { formatPhone, useMe } from '../../auth/model/queries.js';
import { billingApi, rupees } from '../api.js';

/** Printable GST tax invoice. Seller details come from config once the company is registered. */
export function InvoicePage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const invoice = useQuery({ queryKey: ['billing', 'invoice', id], queryFn: () => billingApi.invoice(id) });
  const me = useMe().data;
  const inv = invoice.data;
  if (!inv) return <p className="p-8 text-center text-sm text-muted">{t('common.loading')}</p>;
  const base = inv.amountPaise - inv.gstPaise;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
      <div className="flex items-center justify-between print:hidden">
        <button type="button" onClick={() => navigate('/settings/billing')} aria-label={t('numbers.back')} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <Button variant="outline" size="sm" onClick={() => window.print()} leftIcon={<Printer className="size-4" aria-hidden />}>
          {t('billing.print')}
        </Button>
      </div>
      <article className="mt-4 rounded-lg border border-border bg-white p-8 text-[#12121A]">
        <div className="flex items-start justify-between">
          <Logo className="[&_span]:text-[#12121A]" />
          <div className="text-right text-sm">
            <p className="text-lg font-bold">{t('billing.taxInvoice')}</p>
            <p className="font-mono">{inv.invoiceNo}</p>
            <p>{new Date(inv.paidAt).toLocaleDateString()}</p>
          </div>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-6 text-sm">
          <div>
            <p className="font-semibold">{t('billing.from')}</p>
            <p>Hellogram</p>
            <p className="text-[#5E5E72]">{t('billing.gstinPending')}</p>
          </div>
          <div>
            <p className="font-semibold">{t('billing.billedTo')}</p>
            <p>{me ? formatPhone(me.phone) : ''}</p>
            {me?.email && <p>{me.email}</p>}
          </div>
        </div>
        <table className="mt-6 w-full text-sm">
          <thead>
            <tr className="border-b border-[#E3E3EC] text-left">
              <th className="py-2">{t('billing.item')}</th>
              <th className="py-2 text-right">{t('billing.amount')}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-[#E3E3EC]">
              <td className="py-2">{t('billing.itemName')} (SAC 998422)</td>
              <td className="py-2 text-right">{rupees(base)}</td>
            </tr>
            <tr>
              <td className="py-2">IGST @ 18%</td>
              <td className="py-2 text-right">{rupees(inv.gstPaise)}</td>
            </tr>
            <tr className="border-t border-[#12121A] font-bold">
              <td className="py-2">{t('billing.total')}</td>
              <td className="py-2 text-right">{rupees(inv.amountPaise)}</td>
            </tr>
          </tbody>
        </table>
      </article>
    </div>
  );
}
