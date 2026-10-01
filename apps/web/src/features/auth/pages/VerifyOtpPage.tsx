import { Button } from '@hellogram/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../../../core/http/api-error.js';
import {
  getPendingVerification,
  phoneAuthMode,
  setPendingVerification,
  startPhoneVerification,
  type PhoneProof,
} from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { authApi } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { FormError } from '../components/FormError.js';
import { OtpDeliveryNote } from '../components/OtpDeliveryNote.js';
import { OtpInput } from '../components/OtpInput.js';
import { useAuthStore } from '../model/auth-store.js';
import { nextPath, withNext } from '../model/next-path.js';

/** Sign-up (verify the mobile) or login on a new device (verify it's you). */
type VerifyState = { flow: 'signup'; phone: string; signupId: string } | { flow: 'device'; phone: string; ticket: string };

const RESEND_SECONDS = 30;

const formatPhone = (phone: string) => `${phone.slice(0, 3)} ${phone.slice(3, 8)} ${phone.slice(8)}`;

function useCountdown(seconds: number) {
  const [left, setLeft] = useState(seconds);
  useEffect(() => {
    if (left <= 0) return;
    const id = setTimeout(() => setLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [left]);
  return { left, restart: () => setLeft(seconds) };
}

export function VerifyOtpPage() {
  const state = useLocation().state as VerifyState | null;
  const startOver = state?.flow === 'signup' ? '/signup' : '/login';
  if (!state?.phone) return <Navigate to={startOver} replace />;
  // After a reload the in-memory verification is gone: start again.
  if (!getPendingVerification(state.phone)) return <Navigate to={startOver} replace />;
  return <VerifyOtp {...state} />;
}

function VerifyOtp(props: VerifyState) {
  const navigate = useNavigate();
  const { search } = useLocation();
  const signIn = useAuthStore((s) => s.signIn);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState<string | null>(null);
  const countdown = useCountdown(RESEND_SECONDS);
  // A Firebase code can only be confirmed once; keep the proof for a retry after a server error.
  const proof = useRef<PhoneProof | null>(null);

  const verify = useMutation({
    mutationFn: async (value: string) => {
      if (!proof.current) {
        const session = getPendingVerification(props.phone);
        if (!session) throw new Error(t('auth.restart'));
        proof.current = await session.confirm(value);
      }
      return props.flow === 'signup'
        ? authApi.signupVerify(props.signupId, proof.current)
        : authApi.loginVerify(props.ticket, proof.current);
    },
    onSuccess: (result) => {
      signIn(result.accessToken);
      navigate(nextPath(search), { replace: true });
    },
    onError: () => {
      proof.current = null; // wrong code etc.: let the user try again
    },
  });

  const resend = useMutation({
    mutationFn: async () =>
      setPendingVerification(
        props.phone,
        await startPhoneVerification(props.phone, () =>
          props.flow === 'signup' ? authApi.signupResend(props.signupId) : authApi.loginResend(props.ticket),
        ),
      ),
    onSuccess: () => {
      proof.current = null;
      countdown.restart();
      setCode('');
      setNotice(t('auth.resent'));
    },
  });

  const error = verify.error ?? resend.error;
  const accountExists = error instanceof ApiError && error.code === 'ACCOUNT_EXISTS';
  const submit = (value = code) => {
    setNotice(null);
    if (value.length === 6) verify.mutate(value);
  };

  const mm = String(Math.floor(countdown.left / 60)).padStart(2, '0');
  const ss = String(countdown.left % 60).padStart(2, '0');
  const target = formatPhone(props.phone);

  return (
    <AuthLayout>
      <button
        type="button"
        onClick={() => navigate(withNext(props.flow === 'signup' ? '/signup' : '/login', search))}
        aria-label={t('auth.back')}
        className="mb-6 inline-flex size-11 items-center justify-center rounded-full border border-border text-muted hover:bg-surface-2"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>

      <h1 className="text-2xl font-bold tracking-tight">
        {props.flow === 'signup' ? t('auth.verifyMobileTitle') : t('auth.verifyDeviceTitle')}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {props.flow === 'signup' ? t('auth.sentTo', { target }) : t('auth.verifyDeviceBody', { target })}
      </p>
      <OtpDeliveryNote when="after" className="mt-4" />

      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <OtpInput value={code} onChange={setCode} onComplete={submit} disabled={verify.isPending} invalid={Boolean(error)} />
        <FormError message={error?.message ?? null} />
        {accountExists && (
          <Link to={withNext('/login', search)} className="text-sm font-semibold text-primary underline underline-offset-4">
            {t('auth.logIn')}
          </Link>
        )}
        {notice && (
          <p className="text-sm text-success" role="status">
            {notice}
          </p>
        )}

        <Button type="submit" variant="gradient" size="lg" fullWidth disabled={code.length !== 6 || verify.isPending}>
          {t('auth.verify')}
        </Button>

        <p className="text-center text-sm text-muted" aria-live="polite">
          {countdown.left > 0 ? (
            t('auth.resendIn', { time: `${mm}:${ss}` })
          ) : (
            <button
              type="button"
              onClick={() => resend.mutate()}
              disabled={resend.isPending}
              className="font-semibold text-primary underline underline-offset-4"
            >
              {t('auth.resend')}
            </button>
          )}
        </p>

        {import.meta.env.DEV && (
          <p className="rounded-md bg-surface-2 p-3 text-xs text-muted">
            {phoneAuthMode === 'firebase' ? t('auth.devHintFirebase') : t('auth.devHint')}
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
