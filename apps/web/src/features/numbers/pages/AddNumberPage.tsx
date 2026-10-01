import { Button, Card, Switch, TextField } from '@hellogram/ui';
import { ArrowLeft, CheckCircle2, Crown } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { startCheckout } from '../../billing/checkout.js';
import { FormError } from '../../auth/components/FormError.js';
import { LabelEditor, type LabelValue } from '../components/LabelPicker.js';
import { useCreateNumber, useNumbers } from '../model/queries.js';

export function AddNumberPage() {
  const navigate = useNavigate();
  const { data } = useNumbers();
  const create = useCreateNumber();
  const [label, setLabel] = useState<LabelValue>({ labelName: '', labelIcon: 'tag' });
  const [displayName, setDisplayName] = useState('');
  const [allowCalls, setAllowCalls] = useState(true);
  const [allowMedia, setAllowMedia] = useState(true);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);

  const plan = data?.plan;
  const needsPayment = plan ? plan.freeLeft === 0 : false;
  const atMax = plan ? plan.used >= plan.max : false;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    setCheckoutError(null);
    create.mutate(
      { displayName, labelName: label.labelName.trim(), labelIcon: label.labelIcon, allowCalls, allowMedia },
      {
        onSuccess: async (result) => {
          if (result.kind === 'created') {
            navigate(`/numbers/${result.persona.id}`, { replace: true });
            return;
          }
          try {
            const personaId = await startCheckout(result.checkout);
            if (personaId) navigate(`/numbers/${personaId}`, { replace: true });
          } catch (error) {
            setCheckoutError(error instanceof Error ? error.message : String(error));
          }
        },
      },
    );
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
      <button
        type="button"
        onClick={() => navigate(-1)}
        aria-label={t('numbers.back')}
        className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <h1 className="mt-2 text-2xl font-bold tracking-tight">{t('numbers.addTitle')}</h1>
      <p className="mt-1 text-sm text-muted">{t('numbers.addSubtitle')}</p>

      {atMax ? (
        <Card className="mt-6 p-5 text-sm">{t('numbers.limitReached')}</Card>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-5">
          <Card className="flex flex-col gap-5 p-4">
            <LabelEditor value={label} onChange={setLabel} />
            <TextField
              label={t('numbers.displayName')}
              placeholder={t('numbers.displayNamePlaceholder')}
              hint={t('numbers.displayNameHint')}
              maxLength={40}
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              required
            />
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t('numbers.allowCalls')}</p>
                <p className="text-xs text-muted">{t('numbers.allowCallsHint')}</p>
              </div>
              <Switch checked={allowCalls} onCheckedChange={setAllowCalls} label={t('numbers.allowCalls')} />
            </div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-sm font-medium">{t('numbers.allowMedia')}</p>
                <p className="text-xs text-muted">{t('numbers.allowMediaHint')}</p>
              </div>
              <Switch checked={allowMedia} onCheckedChange={setAllowMedia} label={t('numbers.allowMedia')} />
            </div>
          </Card>

          {needsPayment && (
            <Card className="border-transparent bg-gradient-to-br from-label-olx/15 via-primary/15 to-label-dating/15 p-5">
              <p className="text-sm font-semibold text-label-dating">{t('numbers.usedFree')}</p>
              <div className="mt-3 flex items-start justify-between gap-4">
                <div>
                  <p className="text-sm text-muted">{t('numbers.extraTitle')}</p>
                  <p className="text-2xl font-bold">{t('numbers.extraPrice')}</p>
                  <p className="text-sm text-muted">{t('numbers.cancelAnytime')}</p>
                </div>
                <Crown className="size-10 text-label-olx" aria-hidden />
              </div>
              <ul className="mt-4 flex flex-col gap-2 text-sm">
                {[t('numbers.benefit1'), t('numbers.benefit2'), t('numbers.benefit3')].map((b) => (
                  <li key={b} className="flex items-center gap-2">
                    <CheckCircle2 className="size-4 text-primary" aria-hidden />
                    {b}
                  </li>
                ))}
              </ul>
            </Card>
          )}

          <FormError message={create.error?.message ?? checkoutError} />
          <Button
            type="submit"
            variant="gradient"
            size="lg"
            fullWidth
            disabled={!displayName.trim() || !label.labelName.trim() || create.isPending}
          >
            {needsPayment ? t('numbers.payCreate') : t('numbers.create')}
          </Button>
          {needsPayment && (
            <p className="text-center text-xs text-muted">
              {t('numbers.payVia')} · <span className="font-semibold">UPI · VISA · Mastercard · RuPay</span>
            </p>
          )}
        </form>
      )}
    </div>
  );
}
