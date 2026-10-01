import { Button } from '@hellogram/ui';
import { useMutation } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { ApiError } from '../../../core/http/api-error.js';
import {
  getPendingVerification,
  phoneAuthMode,
  setPendingVerification,
  startPhoneVerification,
  type PhoneProof,
} from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { authApi, type LoginResponse } from '../api/auth.api.js';
import { AuthLayout } from '../components/AuthLayout.js';
import { ConsentStep } from '../components/ConsentStep.js';
import { FormError } from '../components/FormError.js';
import { OtpInput } from '../components/OtpInput.js';
import { useAuthStore } from '../model/auth-store.js';

interface VerifyState {
  channel: 'phone' | 'email';
  target: string;
}

const RESEND_SECONDS = 30;

const formatTarget = ({ channel, target }: VerifyState) =>
  channel === 'phone' ? `${target.slice(0, 3)} ${target.slice(3, 8)} ${target.slice(8)}` : target;

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
  if (!state?.target) return <Navigate to="/login" replace />;
  // After a reload the in-memory phone verification is gone: start again.
  if (state.channel === 'phone' && !getPendingVerification(state.target)) return <Navigate to="/login" replace />;
  return <VerifyOtp {...state} />;
}

function VerifyOtp(props: VerifyState) {
  const navigate = useNavigate();
  const signIn = useAuthStore((s) => s.signIn);
  const [code, setCode] = useState('');
  const [consentVersion, setConsentVersion] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const countdown = useCountdown(RESEND_SECONDS);
  // The phone proof is kept so the 18+ step can resubmit it (a Firebase code can only be confirmed once).
  const proof = useRef<PhoneProof | null>(null);

  const verify = useMutation({
    mutationFn: async (input: { code: string; ageConfirmed?: boolean; consentVersion?: string }): Promise<LoginResponse> => {
      if (props.channel === 'email') return authApi.verifyEmailOtp({ email: props.target, code: input.code });
      if (!proof.current) {
        const session = getPendingVerification(props.target);
        if (!session) throw new Error(t('auth.restart'));
        proof.current = await session.confirm(input.code);
      }
      const consent = input.ageConfirmed ? { ageConfirmed: true, consentVersion: input.consentVersion ?? '' } : {};
      return authApi.verifyPhoneProof(props.target, proof.current, consent);
    },
    onSuccess: (result) => {
      signIn(result.accessToken);
      navigate('/numbers', { replace: true });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.code === 'AGE_CONFIRMATION_REQUIRED') {
        const details = error.details as { consentVersion?: string } | undefined;
        setConsentVersion(details?.consentVersion ?? '');
      } else {
        proof.current = null; // wrong code etc.: let the user try again
      }
    },
  });

  const resend = useMutation({
    mutationFn: async () => {
      if (props.channel === 'email') return authApi.sendEmailOtp(props.target);
      setPendingVerification(props.target, await startPhoneVerification(props.target, () => authApi.sendPhoneOtp(props.target)));
    },
    onSuccess: () => {
      proof.current = null;
      countdown.restart();
      setCode('');
      setNotice(t('auth.resent'));
    },
  });

  const error = [verify.error, resend.error].find(
    (e): e is Error => e instanceof Error && !(e instanceof ApiError && e.code === 'AGE_CONFIRMATION_REQUIRED'),
  );
  const submit = (value = code) => {
    setNotice(null);
    if (value.length === 6) verify.mutate({ code: value });
  };

  if (consentVersion !== null) {
    return (
      <AuthLayout>
        <ConsentStep
          pending={verify.isPending}
          error={error?.message ?? null}
          onConfirm={() => verify.mutate({ code, ageConfirmed: true, consentVersion })}
        />
      </AuthLayout>
    );
  }

  const mm = String(Math.floor(countdown.left / 60)).padStart(2, '0');
  const ss = String(countdown.left % 60).padStart(2, '0');

  return (
    <AuthLayout>
      <button
        type="button"
        onClick={() => navigate(props.channel === 'phone' ? '/login' : '/login/email')}
        aria-label={t('auth.back')}
        className="mb-6 inline-flex size-11 items-center justify-center rounded-full border border-border text-muted hover:bg-surface-2"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>

      <h1 className="text-2xl font-bold tracking-tight">{t('auth.enterOtp')}</h1>
      <p className="mt-1 text-sm text-muted">{t('auth.sentTo', { target: formatTarget(props) })}</p>

      <form
        className="mt-8 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <OtpInput
          value={code}
          onChange={setCode}
          onComplete={submit}
          disabled={verify.isPending}
          invalid={Boolean(error)}
        />
        <FormError message={error?.message ?? null} />
        {notice && <p className="text-sm text-success" role="status">{notice}</p>}

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
            {phoneAuthMode === 'firebase' && props.channel === 'phone' ? t('auth.devHintFirebase') : t('auth.devHint')}
          </p>
        )}
      </form>
    </AuthLayout>
  );
}
