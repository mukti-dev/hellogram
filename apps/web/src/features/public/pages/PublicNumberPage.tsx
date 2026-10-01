import { isValidNumberCode, normalizeNumberCode, type OwnPersonaDto } from '@hellogram/shared';
import { Avatar, Button, Card, Logo, NumberCode, TextField, cn } from '@hellogram/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, EyeOff, ShieldCheck, Smartphone } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { t } from '../../../i18n/t.js';
import { AdultsOnlyFooter } from '../../auth/components/AdultsOnlyFooter.js';
import { FormError } from '../../auth/components/FormError.js';
import { refreshAccessToken } from '../../../core/http/client.js';
import { useAuthStore } from '../../auth/model/auth-store.js';
import { numbersApi } from '../../numbers/api/numbers.api.js';
import { requestsApi } from '../../requests/api/requests.api.js';
import { LabelEditor, type LabelValue } from '../../numbers/components/LabelPicker.js';

type Step = 'form' | 'name' | 'sent';
const INTRO_MAX = 300;

/** The intro survives the trip through sign-up / login (this tab only). */
const draftKey = (code: string) => `hg-intro:${code}`;
const readDraft = (code: string) => {
  try {
    return window.sessionStorage.getItem(draftKey(code)) ?? '';
  } catch {
    return '';
  }
};
const saveDraft = (code: string, value: string) => {
  try {
    if (value) window.sessionStorage.setItem(draftKey(code), value);
    else window.sessionStorage.removeItem(draftKey(code));
  } catch {
    /* storage blocked: the intro just isn't kept */
  }
};

/**
 * Receiver web entry (screen 6). Visitors sign up (or log in) first, then come back here,
 * pick or create the number they send from, and send the request.
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
  const navigate = useNavigate();

  const [step, setStep] = useState<Step>('form');
  const [intro, setIntroState] = useState(() => readDraft(code));
  const setIntro = (value: string) => {
    setIntroState(value);
    saveDraft(code, value);
  };
  const [name, setName] = useState('');
  const [label, setLabel] = useState<LabelValue>({ labelName: '', labelIcon: 'tag' });
  const [fromId, setFromId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const next = encodeURIComponent(`/${code}`);

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
    onSuccess: () => {
      saveDraft(code, '');
      setStep('sent');
    },
    onError: fail,
  });

  const createAndSend = useMutation({
    mutationFn: async () => {
      const created = await numbersApi.create({
        displayName: name,
        labelName: label.labelName.trim(),
        labelIcon: label.labelIcon,
        allowCalls: true,
        allowMedia: true,
      });
      if (created.kind !== 'created') throw new Error('Could not create your number');
      await requestsApi.send({ fromPersonaId: created.persona.id, toCode: code, introMessage: intro });
    },
    onSuccess: () => setStep('sent'),
    onError: fail,
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
  const busy = sendRequest.isPending || createAndSend.isPending;

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
            <div className="flex flex-col gap-4">
              {introField}
              <p className="text-center text-sm text-muted">{t('public.joinFirst', { name: firstName })}</p>
              <Button variant="gradient" size="lg" fullWidth onClick={() => navigate(`/signup?next=${next}`)}>
                {t('public.signupToSend')}
              </Button>
              <p className="text-center text-sm text-muted">
                {t('auth.haveAccount')}{' '}
                <Link to={`/login?next=${next}`} className="font-semibold text-primary underline underline-offset-4">
                  {t('auth.logIn')}
                </Link>
              </p>
            </div>
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

          {step === 'name' && (
            <form
              className="flex flex-col gap-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (name.trim() && label.labelName.trim()) createAndSend.mutate();
              }}
            >
              <p className="text-sm text-muted">{t('public.firstNumber')}</p>
              <LabelEditor value={label} onChange={setLabel} />
              <TextField
                label={t('public.yourName')}
                hint={t('public.yourNameHint', { name: firstName })}
                value={name}
                maxLength={40}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
              {introField}
              <Button type="submit" variant="gradient" size="lg" fullWidth disabled={!name.trim() || !label.labelName.trim() || busy}>
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

          <FormError message={error} />
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
