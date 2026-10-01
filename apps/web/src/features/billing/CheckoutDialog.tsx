import { Button, Dialog } from '@hellogram/ui';
import { useState } from 'react';
import { api } from '../../core/http/client.js';
import { t } from '../../i18n/t.js';
import { useCheckoutUi } from './checkout.js';

/** Dev-only payment simulator (BILLING_PROVIDER=dev). Mimics a successful UPI Autopay. */
export function CheckoutDialog() {
  const pending = useCheckoutUi((s) => s.pending);
  const close = useCheckoutUi((s) => s.close);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!pending) return null;
  const amount = Number(pending.checkout.payload['amountPaise'] ?? 4900) / 100;

  const pay = async () => {
    setBusy(true);
    setError(null);
    try {
      const { personaId } = await api<{ personaId: string | null }>('/v1/billing/dev/confirm', {
        method: 'POST',
        body: { draftId: pending.checkout.draftId },
      });
      pending.resolve(personaId);
      useCheckoutUi.setState({ pending: null });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Payment failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && close()} title={t('billing.simTitle')} description={t('billing.simBody')}>
      <div className="flex flex-col gap-4">
        <div className="rounded-lg border border-border bg-surface-2 p-4 text-center">
          <p className="text-sm text-muted">{t('billing.monthly')}</p>
          <p className="text-3xl font-bold">₹{amount.toFixed(0)}</p>
          <p className="text-xs text-muted">{t('billing.inclGst')}</p>
        </div>
        {error && <p className="text-sm text-danger">{error}</p>}
        <Button variant="gradient" fullWidth disabled={busy} onClick={() => void pay()}>
          {t('billing.simPay')}
        </Button>
        <Button variant="ghost" fullWidth onClick={close}>
          {t('common.cancel')}
        </Button>
      </div>
    </Dialog>
  );
}
