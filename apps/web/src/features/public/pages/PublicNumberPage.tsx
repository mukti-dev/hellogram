import { isValidNumberCode, normalizeNumberCode, type OwnPersonaDto } from '@hellogram/shared';
import { Avatar, Button, Card, Logo, NumberCode, TextField, cn } from '@hellogram/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ChevronDown, EyeOff, ShieldCheck, Smartphone } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Turnstile, turnstileEnabled } from '../../../shared/Turnstile.js';
import { phoneAuthMode, startPhoneVerification, type PhoneProof, type VerificationSession } from '../../../core/phone/verification.js';
import { Link, Navigate, useParams } from 'react-router';
import { ApiError } from '../../../core/http/api-error.js';
import { t } from '../../../i18n/t.js';
import { authApi } from '../../auth/api/auth.api.js';
import { AdultsOnlyFooter } from '../../auth/components/AdultsOnlyFooter.js';
import { ConsentStep } from '../../auth/components/ConsentStep.js';
import { FormError } from '../../auth/components/FormError.js';
import { OtpInput } from '../../auth/components/OtpInput.js';
import { refreshAccessToken } from '../../../core/http/client.js';
import { useAuthStore } from '../../auth/model/auth-store.js';
import { numbersApi } from '../../numbers/api/numbers.api.js';
import { requestsApi } from '../../requests/api/requests.api.js';

type Step = 'form' | 'otp' | 'consent' | 'name' | 'sent';
const INTRO_MAX = 300;

/**
 * Receiver web entry (screen 6): works logged out. A visitor verifies their phone,
 * gets their own first number (they pick the name) and the request is sent from it.
 */
export function PublicNumberPage() {
  const { code: raw = '' } = useParams();
  if (!isValidNumberCode(raw)) return <Navigate to="/" replace />;
  const code = normalizeNumberCode(raw);
  if (code !== raw) return <Navigate to={`/${code}`} replace />;
  return <PublicNumber code={code} />;
}

function PublicNumber({ code }: { code: string }) {
  const card = useQuery({ queryKey: ['public', code], queryFn: () => requestsApi.publicCard(code), retry: false });
  const status = useAuthStore((s) => s.status);
  const signIn = useAuthStore((s) => s.signIn);

  const [step, setStep] = useState<Step>('form');
  const [mobile, setMobile] = useState('');
  const [otp, setOtp] = useState('');
  const [intro, setIntro] = useState('');
  const [name, setName] = useState('');
  const [fromId, setFromId] = useState<string | null>(null);
  const [consentVersion, setConsentVersion] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [human, setHuman] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setHuman(t), []);
  const digits = mobile.replace(/\D/g, '');
  const phone = `+91${digits}`;

  // Restore an existing session silently (the page is public, so it isn't behind the guard).
  useEffect(() => {
    if (status === 'unknown') void refreshAccessToken();
  }, [status]);

  const myNumbers = useQuery({
    queryKey: ['personas'],
    queryFn: numbersApi.list,
    enabled: status === 'authenticated',
  });
  const mine: OwnPersonaDto[] = myNumbers.data?.items ?? [];
  const selectedFrom = fromId ?? mine.find((p) => p.status === 'active')?.id ?? null;

  const fail = (e: unknown) => setError(e instanceof Error ? e.message : 'Something went wrong');

  const sendRequest = useMutation({
    mutationFn: (fromPersonaId: string) => requestsApi.send({ fromPersonaId, toCode: code, introMessage: intro }),
    onSuccess: () => setStep('sent'),
    onError: fail,
  });

  const createAndSend = useMutation({
    mutationFn: async () => {
      const created = await numbersApi.create({ displayName: name, labelKind: 'other', labelText: null, allowCalls: true });
      if (created.kind !== 'created') throw new Error('Could not create your number');
      await requestsApi.send({ fromPersonaId: created.persona.id, toCode: code, introMessage: intro });
    },
    onSuccess: () => setStep('sent'),
    onError: fail,
  });

  const verification = useRef<VerificationSession | null>(null);
  const proof = useRef<PhoneProof | null>(null);

  const sendOtp = useMutation({
    mutationFn: async () => {
      verification.current = await startPhoneVerification(phone, () => authApi.sendPhoneOtp(phone, human));
      proof.current = null;
    },
    onSuccess: () => {
      setError(null);
      setStep('otp');
    },
    onError: fail,
  });

  const verify = useMutation({
    mutationFn: async (input: { ageConfirmed?: boolean; consentVersion?: string }) => {
      // Keep the proof: the 18+ step resubmits it (a Firebase code can only be confirmed once).
      proof.current ??= await verification.current!.confirm(otp);
      return authApi.verifyPhoneProof(phone, proof.current, input);
    },
    onSuccess: async (result) => {
      signIn(result.accessToken);
      setError(null);
      const list = await numbersApi.list();
      const active = list.items.filter((p) => p.status === 'active');
      if (active.length === 0) setStep('name');
      else if (active.length === 1) sendRequest.mutate(active[0]!.id);
      else setStep('form');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'AGE_CONFIRMATION_REQUIRED') {
        setConsentVersion((e.details as { consentVersion?: string } | undefined)?.consentVersion ?? '');
        setStep('consent');
      } else {
        proof.current = null;
        fail(e);
      }
    },
  });

  if (card.isLoading) return <Shell>{t('common.loading')}</Shell>;
  if (card.isError || !card.data) {
    return (
      <Shell>
        <Card className="p-6 text-center">
          <p className="text-lg font-semibold">{t('public.notFound')}</p>
          <p className="mt-1 text-sm text-muted">{t('public.notFoundHint')}</p>
        </Card>
      </Shell>
    );
  }

  const person = card.data;
  const firstName = person.displayName.split(' ')[0] ?? person.displayName;
  const busy = sendOtp.isPending || verify.isPending || sendRequest.isPending || createAndSend.isPending;

  const introField = (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="intro" className="text-sm font-medium">
        {t('public.intro')}
      </label>
      <textarea
        id="intro"
        rows={3}
        maxLength={INTRO_MAX}
        value={intro}
        onChange={(e) => setIntro(e.target.value)}
        placeholder={t('public.introPlaceholder')}
        className="resize-none rounded-md border border-border bg-surface-2 p-3 text-sm outline-none placeholder:text-muted focus:border-primary focus:ring-2 focus:ring-primary/40"
      />
      <p className="text-right text-xs text-muted">
        {intro.length}/{INTRO_MAX}
      </p>
    </div>
  );

  return (
    <Shell>
      <Card className="flex flex-col items-center bg-gradient-to-b from-primary/20 to-surface-1 p-6 text-center">
        <Avatar name={person.displayName} src={person.avatarUrl} size={88} />
        <h1 className="mt-3 text-xl font-bold">{person.displayName}</h1>
        <div className="mt-3 rounded-md border border-border bg-surface-2 px-4 py-2">
          <NumberCode code={person.code} className="text-xl" />
        </div>
      </Card>

      <p className="mt-5 text-center font-semibold">
        {t('public.reach', { name: firstName })}
        <br />
        <span className="font-normal text-muted">{t('public.hidden')}</span>
      </p>

      {!person.acceptsRequests && step !== 'sent' ? (
        <Card className="mt-5 p-4 text-center text-sm">{t('public.notAccepting', { name: firstName })}</Card>
      ) : (
        <div className="mt-5 flex flex-col gap-4">
          {step === 'form' && status !== 'authenticated' && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (/^[6-9]\d{9}$/.test(digits)) sendOtp.mutate();
              }}
            >
              <div className="flex h-12 items-center rounded-md border border-border bg-surface-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40">
                <span className="flex h-full items-center gap-1 border-r border-border px-3 text-sm font-semibold">
                  +91 <ChevronDown className="size-4 text-muted" aria-hidden />
                </span>
                <label htmlFor="visitor-mobile" className="sr-only">
                  {t('auth.mobileLabel')}
                </label>
                <input
                  id="visitor-mobile"
                  type="tel"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  placeholder={t('auth.mobilePlaceholder')}
                  value={mobile}
                  onChange={(e) => setMobile(e.target.value.replace(/[^\d\s]/g, '').slice(0, 11))}
                  className="h-full min-w-0 flex-1 bg-transparent px-3 text-sm outline-none placeholder:text-muted"
                />
              </div>
              {phoneAuthMode === 'otp' && <Turnstile onToken={onToken} />}
              <Button
                type="submit"
                variant="gradient"
                size="lg"
                fullWidth
                disabled={!/^[6-9]\d{9}$/.test(digits) || busy || (turnstileEnabled && phoneAuthMode === 'otp' && !human)}
              >
                {t('auth.sendOtp')}
              </Button>
              {introField}
            </form>
          )}

          {step === 'form' && status === 'authenticated' && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (selectedFrom) sendRequest.mutate(selectedFrom);
                else setStep('name');
              }}
            >
              {mine.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <label htmlFor="from-number" className="text-sm font-medium">
                    {t('public.fromNumber')}
                  </label>
                  <select
                    id="from-number"
                    value={selectedFrom ?? ''}
                    onChange={(e) => setFromId(e.target.value)}
                    className="h-12 rounded-md border border-border bg-surface-2 px-3 text-sm"
                  >
                    {mine
                      .filter((p) => p.status === 'active')
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.displayName} · {p.code}
                        </option>
                      ))}
                  </select>
                </div>
              )}
              {introField}
              <Button type="submit" variant="gradient" size="lg" fullWidth disabled={busy}>
                {t('public.sendRequest')}
              </Button>
            </form>
          )}

          {step === 'otp' && (
            <div className="flex flex-col gap-4">
              <p className="text-center text-sm text-muted">{t('auth.sentTo', { target: `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` })}</p>
              <OtpInput value={otp} onChange={setOtp} onComplete={() => verify.mutate({})} disabled={busy} />
              <Button variant="gradient" size="lg" fullWidth disabled={otp.length !== 6 || busy} onClick={() => verify.mutate({})}>
                {t('auth.verify')}
              </Button>
              {import.meta.env.DEV && <p className="rounded-md bg-surface-2 p-3 text-xs text-muted">{t('auth.devHint')}</p>}
            </div>
          )}

          {step === 'consent' && (
            <ConsentStep
              pending={busy}
              error={error}
              onConfirm={() => verify.mutate({ ageConfirmed: true, consentVersion })}
            />
          )}

          {step === 'name' && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim()) createAndSend.mutate();
              }}
            >
              <TextField
                label={t('public.yourName')}
                hint={t('public.yourNameHint', { name: firstName })}
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              {introField}
              <Button type="submit" variant="gradient" size="lg" fullWidth disabled={!name.trim() || busy}>
                {t('public.sendRequest')}
              </Button>
            </form>
          )}

          {step === 'sent' && (
            <Card className="flex flex-col items-center gap-2 p-6 text-center">
              <CheckCircle2 className="size-10 text-success" aria-hidden />
              <p className="text-lg font-semibold">{t('public.sent')}</p>
              <p className="text-sm text-muted">{t('public.sentHint', { name: firstName })}</p>
              <Link to="/inbox" className="mt-2 font-semibold text-primary underline underline-offset-4">
                {t('public.openApp')}
              </Link>
            </Card>
          )}

          {step !== 'consent' && <FormError message={error} />}
        </div>
      )}

      <ul className="mt-8 grid grid-cols-3 gap-2 text-center text-xs text-muted">
        {[
          { icon: Smartphone, text: t('public.trust1') },
          { icon: EyeOff, text: t('public.trust2') },
          { icon: ShieldCheck, text: t('public.trust3') },
        ].map(({ icon: Icon, text }) => (
          <li key={text} className="flex flex-col items-center gap-2">
            <span className={cn('inline-flex size-11 items-center justify-center rounded-full bg-primary-soft text-primary')}>
              <Icon className="size-5" aria-hidden />
            </span>
            {text}
          </li>
        ))}
      </ul>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-5 pt-6 pb-6">
      <div className="mb-6 flex items-center justify-between">
        <Link to="/" aria-label="Hellogram">
          <Logo />
        </Link>
        <span className="rounded-md border border-border px-2 py-1 text-xs text-muted">EN</span>
      </div>
      <div className="flex-1">{children}</div>
      <AdultsOnlyFooter />
    </main>
  );
}
