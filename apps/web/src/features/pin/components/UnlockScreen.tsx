import { Button } from '@hellogram/ui';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Clock, Lock } from 'lucide-react';
import { useRef, useState } from 'react';
import { startPhoneVerification, type PhoneProof, type VerificationSession } from '../../../core/phone/verification.js';
import { useMe } from '../../auth/model/queries.js';
import { ApiError } from '../../../core/http/api-error.js';
import { t } from '../../../i18n/t.js';
import { OtpInput } from '../../auth/components/OtpInput.js';
import { useNumbers } from '../../numbers/model/queries.js';
import { pinApi } from '../api/pin.api.js';
import { useUnlockTokens } from '../model/unlock-tokens.js';
import { useUnlockUi } from '../model/unlock-ui.js';
import { PinPad } from './PinPad.js';

type Step = 'pin' | 'reset-warn' | 'reset-code' | 'reset-new' | 'reset-confirm';

/** Screen 11: full-screen lock for a PIN-protected number. */
export function UnlockScreen() {
  const personaId = useUnlockUi((s) => s.personaId);
  if (!personaId) return null;
  return <Unlock key={personaId} personaId={personaId} />;
}

function Unlock({ personaId }: { personaId: string }) {
  const close = useUnlockUi((s) => s.close);
  const setToken = useUnlockTokens((s) => s.set);
  const client = useQueryClient();
  const number = useNumbers().data?.items.find((p) => p.id === personaId);
  const [step, setStep] = useState<Step>('pin');
  const [pin, setPin] = useState('');
  const [code, setCode] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const me = useMe();
  const verification = useRef<VerificationSession | null>(null);
  const resetProof = useRef<PhoneProof | null>(null);

  const done = (token: string) => {
    setToken(personaId, token);
    close();
    void client.invalidateQueries();
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PIN_LOCKED_OUT') {
        const retryAt = (e.details as { retryAt?: string } | undefined)?.retryAt;
        setError(retryAt ? t('pin.lockedUntil', { time: new Date(retryAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }) : e.message);
      } else if (e instanceof ApiError && e.code === 'PIN_INVALID') {
        const left = (e.details as { attemptsLeft?: number } | undefined)?.attemptsLeft;
        setError(left ? t('pin.wrongLeft', { n: left }) : e.message);
      } else {
        setError(e instanceof Error ? e.message : 'Something went wrong');
      }
      setPin('');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  const name = number?.displayName ?? t('pin.thisNumber');

  return (
    <div role="dialog" aria-modal="true" aria-label={t('chat.lockedNumber', { name })} className="fixed inset-0 z-50 flex flex-col items-center overflow-y-auto bg-bg px-6 py-8">
      <div className="flex w-full max-w-sm">
        <button type="button" onClick={step === 'pin' ? close : () => setStep('pin')} aria-label={t('numbers.back')} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <ArrowLeft className="size-5" aria-hidden />
        </button>
      </div>
      <span className="mt-4 inline-flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-primary to-label-dating text-white shadow-lg">
        <Lock className="size-9" aria-hidden />
      </span>
      <h1 className="mt-5 text-2xl font-bold">{t('chat.lockedNumber', { name })}</h1>

      {step === 'pin' && (
        <>
          <p className="mt-2 text-sm text-muted">{t('pin.enter')}</p>
          <div className="mt-8">
            <PinPad value={pin} onChange={setPin} disabled={busy} error={Boolean(error)} onComplete={(v) => run(async () => done((await pinApi.unlock(personaId, v)).unlockToken))} />
          </div>
          <p role="alert" className="mt-4 min-h-5 text-sm text-danger">{error}</p>
          <button type="button" onClick={() => setStep('reset-warn')} className="mt-2 text-sm font-semibold text-primary underline underline-offset-4">
            {t('pin.forgot')}
          </button>
          <p className="mt-6 flex max-w-sm items-start gap-2 rounded-md border border-border bg-surface-1 p-3 text-xs text-muted">
            <Clock className="mt-0.5 size-4 shrink-0" aria-hidden />
            {t('pin.resetWarning')}
          </p>
        </>
      )}

      {step === 'reset-warn' && (
        <div className="mt-6 flex w-full max-w-sm flex-col gap-4 text-center">
          <p className="text-sm">{t('pin.resetExplain')}</p>
          <Button
            variant="danger"
            fullWidth
            disabled={busy || !me.data}
            onClick={() =>
              run(async () => {
                // Code goes to the account's own phone (our SMS, or Firebase).
                verification.current = await startPhoneVerification(me.data!.phone, () => pinApi.sendResetOtp(personaId));
                setStep('reset-code');
              })
            }
          >
            {t('pin.sendCode')}
          </Button>
          <p role="alert" className="text-sm text-danger">{error}</p>
        </div>
      )}

      {step === 'reset-code' && (
        <div className="mt-6 flex w-full max-w-sm flex-col gap-4">
          <p className="text-center text-sm text-muted">{t('pin.codeSent')}</p>
          <OtpInput
            value={code}
            onChange={setCode}
            disabled={busy}
            onComplete={(value) =>
              run(async () => {
                // Check the code now (Firebase rejects a wrong one immediately), then choose the new PIN.
                resetProof.current = await verification.current!.confirm(value);
                setStep('reset-new');
              })
            }
          />
          <p role="alert" className="text-center text-sm text-danger">{error}</p>
        </div>
      )}

      {step === 'reset-new' && (
        <>
          <p className="mt-2 text-sm text-muted">{t('pin.chooseNew')}</p>
          <div className="mt-8">
            <PinPad value={newPin} onChange={setNewPin} onComplete={() => setStep('reset-confirm')} />
          </div>
        </>
      )}

      {step === 'reset-confirm' && (
        <>
          <p className="mt-2 text-sm text-muted">{t('pin.confirmNew')}</p>
          <div className="mt-8">
            <PinPad
              value={confirmPin}
              onChange={setConfirmPin}
              disabled={busy}
              error={Boolean(error)}
              onComplete={(v) => {
                if (v !== newPin) {
                  setError(t('pin.mismatch'));
                  setConfirmPin('');
                  return;
                }
                void run(async () => done((await pinApi.reset(personaId, resetProof.current!, newPin)).unlockToken));
              }}
            />
          </div>
          <p role="alert" className="mt-4 min-h-5 text-sm text-danger">{error}</p>
        </>
      )}
    </div>
  );
}
