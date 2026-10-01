import { Button, Card } from '@hellogram/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Mail } from 'lucide-react';
import { useState } from 'react';
import { ApiError } from '../../../core/http/api-error.js';
import { t } from '../../../i18n/t.js';
import { meApi } from '../../auth/api/auth.api.js';
import { FormError } from '../../auth/components/FormError.js';
import { OtpInput } from '../../auth/components/OtpInput.js';
import { meKeys, useMe } from '../../auth/model/queries.js';

/** Recovery email: also a login method (magic code) if the phone is lost. */
export function EmailSection() {
  const me = useMe();
  const client = useQueryClient();
  const [step, setStep] = useState<'idle' | 'email' | 'code'>('idle');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');

  const start = useMutation({ mutationFn: () => meApi.startEmail(email.trim()), onSuccess: () => setStep('code') });
  const confirm = useMutation({
    mutationFn: (value: string) => meApi.confirmEmail(email.trim(), value),
    onSuccess: async () => {
      setStep('idle');
      setCode('');
      await client.invalidateQueries({ queryKey: meKeys.me });
    },
  });
  const error = [start.error, confirm.error].find((e) => e instanceof ApiError) as ApiError | undefined;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Mail className="mt-0.5 size-5 text-muted" aria-hidden />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{t('account.email')}</h2>
          <p className="mt-1 font-medium break-all">
            {me.data?.email ?? t('account.emailNone')}
            {me.data?.email && !me.data.emailVerified && <span className="ml-2 text-xs text-muted">({t('profile.unverified')})</span>}
          </p>
          <p className="text-xs text-muted">{t('account.emailHint')}</p>

          {step === 'idle' && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setStep('email')}>
              {me.data?.email ? t('account.changeEmail') : t('account.addEmail')}
            </Button>
          )}

          {step === 'email' && (
            <form
              className="mt-3 flex flex-col gap-2 sm:flex-row"
              onSubmit={(e) => {
                e.preventDefault();
                start.mutate();
              }}
            >
              <label htmlFor="recovery-email" className="sr-only">
                {t('auth.emailLabel')}
              </label>
              <input
                id="recovery-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.emailPlaceholder')}
                className="h-11 flex-1 rounded-md border border-border bg-surface-2 px-3 text-sm outline-none focus:border-primary"
                autoFocus
              />
              <div className="flex gap-2">
                <Button type="submit" size="sm" className="h-11" disabled={start.isPending || !email.includes('@')}>
                  {t('auth.sendCode')}
                </Button>
                <Button variant="ghost" size="sm" className="h-11" onClick={() => setStep('idle')}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          )}

          {step === 'code' && (
            <div className="mt-3 flex max-w-sm flex-col gap-3">
              <p className="text-sm">{t('account.codeSent', { email: email.trim() })}</p>
              <OtpInput value={code} onChange={setCode} onComplete={(v) => confirm.mutate(v)} disabled={confirm.isPending} />
              <Button variant="ghost" size="sm" onClick={() => setStep('idle')}>
                {t('common.cancel')}
              </Button>
            </div>
          )}
          <div className="mt-2">
            <FormError message={error?.message ?? null} />
          </div>
        </div>
      </div>
    </Card>
  );
}
