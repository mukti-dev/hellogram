import { Button } from '@hellogram/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight, ChevronDown, Mail } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { Turnstile, turnstileEnabled } from '../../../shared/Turnstile.js';
import { useNavigate } from 'react-router';
import { phoneAuthMode, setPendingVerification, startPhoneVerification } from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { authApi } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { FormError } from '../components/FormError.js';

const isValidMobile = (digits: string) => /^[6-9]\d{9}$/.test(digits);

export function LoginPage() {
  const navigate = useNavigate();
  const [mobile, setMobile] = useState('');
  const [human, setHuman] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setHuman(t), []);
  const digits = mobile.replace(/\D/g, '');

  const needsTurnstile = turnstileEnabled && phoneAuthMode === 'otp'; // Firebase has its own reCAPTCHA
  const send = useMutation({
    mutationFn: async () => {
      const phone = `+91${digits}`;
      setPendingVerification(phone, await startPhoneVerification(phone, () => authApi.sendPhoneOtp(phone, human)));
      return phone;
    },
    onSuccess: (phone) => navigate('/login/verify', { state: { channel: 'phone', target: phone } }),
  });

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isValidMobile(digits)) send.mutate();
  };

  return (
    <AuthLayout showHeroOnMobile>
      <div className="hidden lg:block">
        <h2 className="text-2xl font-bold tracking-tight">{t('auth.welcome')}</h2>
        <p className="mt-1 text-sm text-muted">{t('auth.enterMobile')}</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 lg:mt-8" noValidate>
        <label className="sr-only" htmlFor="mobile">
          {t('auth.mobileLabel')}
        </label>
        <div className="flex h-14 items-center rounded-md border border-border bg-surface-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40">
          <span className="flex h-full items-center gap-1 border-r border-border px-4 font-semibold">
            {t('auth.countryCode')}
            <ChevronDown className="size-4 text-muted" aria-hidden />
          </span>
          <input
            id="mobile"
            type="tel"
            inputMode="numeric"
            autoComplete="tel-national"
            placeholder={t('auth.mobilePlaceholder')}
            value={mobile}
            onChange={(e) => setMobile(e.target.value.replace(/[^\d\s]/g, '').slice(0, 11))}
            className="h-full min-w-0 flex-1 bg-transparent px-4 text-base outline-none placeholder:text-muted"
            autoFocus
          />
        </div>

        {phoneAuthMode === 'otp' && <Turnstile onToken={onToken} />}
        <FormError message={send.error?.message ?? null} />

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          fullWidth
          disabled={!isValidMobile(digits) || send.isPending || (needsTurnstile && !human)}
          rightIcon={<ArrowRight className="size-5" aria-hidden />}
        >
          {t('auth.sendOtp')}
        </Button>

        <div className="hidden items-center gap-3 text-xs text-muted lg:flex" aria-hidden>
          <span className="h-px flex-1 bg-border" />
          {t('auth.or')}
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="hidden lg:block">
          <Button
            variant="outline"
            size="lg"
            fullWidth
            leftIcon={<Mail className="size-5" aria-hidden />}
            onClick={() => navigate('/login/email')}
          >
            {t('auth.useEmail')}
          </Button>
        </div>
        <button
          type="button"
          onClick={() => navigate('/login/email')}
          className="mx-auto text-sm font-medium text-fg underline underline-offset-4 lg:hidden"
        >
          {t('auth.useEmail')}
        </button>
      </form>
    </AuthLayout>
  );
}
