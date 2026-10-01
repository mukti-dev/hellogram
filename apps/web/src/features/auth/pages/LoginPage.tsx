import { Button } from '@hellogram/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowRight } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { Link, useLocation, useNavigate } from 'react-router';
import { setPendingVerification, startPhoneVerification } from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { Turnstile, turnstileEnabled } from '../../../shared/Turnstile.js';
import { authApi } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { FormError } from '../components/FormError.js';
import { MobileField, isValidMobile, mobileDigits } from '../components/MobileField.js';
import { OtpDeliveryNote } from '../components/OtpDeliveryNote.js';
import { PasswordField } from '../components/PasswordField.js';
import { useAuthStore } from '../model/auth-store.js';
import { nextPath, withNext } from '../model/next-path.js';

/** Mobile + password. On a device that hasn't verified the mobile yet, a one-time code follows. */
export function LoginPage() {
  const navigate = useNavigate();
  const { search } = useLocation();
  const signIn = useAuthStore((s) => s.signIn);
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [human, setHuman] = useState<string | null>(null);
  const onToken = useCallback((token: string | null) => setHuman(token), []);

  const login = useMutation({
    mutationFn: async () => {
      const phone = `+91${mobileDigits(mobile)}`;
      const result = await authApi.login(phone, password, human);
      if (result.status === 'ok') return { kind: 'signed-in' as const, accessToken: result.accessToken };
      // New device: our server has sent the code (or Firebase sends it from here).
      setPendingVerification(phone, await startPhoneVerification(phone, async () => undefined));
      return { kind: 'verify' as const, phone, ticket: result.ticket };
    },
    onSuccess: (result) => {
      if (result.kind === 'signed-in') {
        signIn(result.accessToken);
        navigate(nextPath(search), { replace: true });
      } else {
        navigate(withNext('/login/verify', search), { state: { flow: 'device', phone: result.phone, ticket: result.ticket } });
      }
    },
  });

  const ready = isValidMobile(mobile) && password.length > 0 && (!turnstileEnabled || Boolean(human));
  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (ready) login.mutate();
  };

  return (
    <AuthLayout showHeroOnMobile>
      <div className="hidden lg:block">
        <h2 className="text-2xl font-bold tracking-tight">{t('auth.welcome')}</h2>
        <p className="mt-1 text-sm text-muted">{t('auth.enterMobile')}</p>
      </div>

      <form onSubmit={onSubmit} className="flex flex-col gap-4 lg:mt-8" noValidate>
        <MobileField value={mobile} onChange={setMobile} autoFocus />
        <PasswordField
          label={t('auth.passwordLabel')}
          placeholder={t('auth.passwordPlaceholder')}
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
        />
        <div className="-mt-1 text-right">
          <Link to="/forgot-password" className="text-sm font-medium text-primary underline-offset-4 hover:underline">
            {t('auth.forgotPassword')}
          </Link>
        </div>

        <Turnstile onToken={onToken} />
        <FormError message={login.error?.message ?? null} />

        <Button
          type="submit"
          variant="gradient"
          size="lg"
          fullWidth
          disabled={!ready || login.isPending}
          rightIcon={<ArrowRight className="size-5" aria-hidden />}
        >
          {t('auth.logIn')}
        </Button>
        <OtpDeliveryNote when="before" />

        <p className="text-center text-sm text-muted">
          {t('auth.noAccount')}{' '}
          <Link to={withNext('/signup', search)} className="font-semibold text-primary underline underline-offset-4">
            {t('auth.createOne')}
          </Link>
        </p>
      </form>
    </AuthLayout>
  );
}
