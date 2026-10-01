import { Button } from '@hellogram/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useCallback, useRef, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { startPhoneVerification, type PhoneProof, type VerificationSession } from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { Turnstile, turnstileEnabled } from '../../../shared/Turnstile.js';
import { authApi } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { FormError } from '../components/FormError.js';
import { MobileField, isValidMobile, mobileDigits } from '../components/MobileField.js';
import { OtpDeliveryNote } from '../components/OtpDeliveryNote.js';
import { OtpInput } from '../components/OtpInput.js';
import { PasswordField } from '../components/PasswordField.js';
import { useAuthStore } from '../model/auth-store.js';
import { passwordProblem } from '../model/password-rules.js';

/** Mobile → code → new password. Every other device is logged out and must verify again. */
export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signIn);
  const [step, setStep] = useState<'phone' | 'reset'>('phone');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [human, setHuman] = useState<string | null>(null);
  const onToken = useCallback((token: string | null) => setHuman(token), []);
  const verification = useRef<VerificationSession | null>(null);
  const proof = useRef<PhoneProof | null>(null);
  const phone = `+91${mobileDigits(mobile)}`;

  const send = useMutation({
    mutationFn: async () => {
      verification.current = await startPhoneVerification(phone, () => authApi.forgotPassword(phone, human));
    },
    onSuccess: () => setStep('reset'),
  });

  const reset = useMutation({
    mutationFn: async () => {
      proof.current ??= await verification.current!.confirm(code);
      return authApi.resetPassword(phone, proof.current, password);
    },
    onSuccess: (result) => {
      signIn(result.accessToken);
      navigate('/numbers', { replace: true });
    },
    onError: () => {
      proof.current = null;
    },
  });

  const problem = passwordProblem(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  const canReset = code.length === 6 && !problem && confirm === password;

  const onSend = (e: FormEvent) => {
    e.preventDefault();
    if (isValidMobile(mobile) && (!turnstileEnabled || human)) send.mutate();
  };
  const onReset = (e: FormEvent) => {
    e.preventDefault();
    if (canReset) reset.mutate();
  };

  return (
    <AuthLayout>
      <button
        type="button"
        onClick={() => (step === 'reset' ? setStep('phone') : navigate('/login'))}
        aria-label={t('auth.back')}
        className="mb-6 inline-flex size-11 items-center justify-center rounded-full border border-border text-muted hover:bg-surface-2"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>

      {step === 'phone' ? (
        <>
          <h1 className="text-2xl font-bold tracking-tight">{t('auth.resetTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.resetIntro')}</p>
          <form onSubmit={onSend} className="mt-6 flex flex-col gap-4" noValidate>
            <MobileField value={mobile} onChange={setMobile} autoFocus />
            <Turnstile onToken={onToken} />
            <FormError message={send.error?.message ?? null} />
            <Button type="submit" variant="gradient" size="lg" fullWidth disabled={!isValidMobile(mobile) || send.isPending}>
              {t('auth.sendResetCode')}
            </Button>
            <OtpDeliveryNote when="before" />
          </form>
        </>
      ) : (
        <>
          <h1 className="text-2xl font-bold tracking-tight">{t('auth.resetCodeTitle')}</h1>
          <p className="mt-1 text-sm text-muted">{t('auth.sentTo', { target: `+91 ${mobileDigits(mobile)}` })}</p>
          <OtpDeliveryNote when="after" className="mt-4" />
          <form onSubmit={onReset} className="mt-6 flex flex-col gap-4" noValidate>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">{t('auth.codeLabel')}</span>
              <OtpInput value={code} onChange={setCode} disabled={reset.isPending} />
            </div>
            <PasswordField
              label={t('auth.newPasswordLabel')}
              value={password}
              onChange={setPassword}
              autoComplete="new-password"
              hint={t('auth.passwordHint')}
              error={password ? problem : null}
            />
            <PasswordField
              label={t('auth.confirmPasswordLabel')}
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              error={mismatch ? t('auth.passwordsDontMatch') : null}
            />
            <FormError message={reset.error?.message ?? null} />
            <Button type="submit" variant="gradient" size="lg" fullWidth disabled={!canReset || reset.isPending}>
              {t('auth.savePassword')}
            </Button>
          </form>
        </>
      )}
    </AuthLayout>
  );
}
