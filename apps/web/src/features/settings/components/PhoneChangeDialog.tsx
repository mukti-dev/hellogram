import { Button, Dialog, TextField } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { api } from '../../../core/http/client.js';
import { startPhoneVerification, type PhoneProof, type VerificationSession } from '../../../core/phone/verification.js';
import { t } from '../../../i18n/t.js';
import { OtpInput } from '../../auth/components/OtpInput.js';
import { formatPhone } from '../../auth/model/queries.js';
import { OtpDeliveryNote } from '../../auth/components/OtpDeliveryNote.js';

export interface PendingPhoneChange {
  newPhone: string;
  effectiveAt: string;
}

export const phoneChangeKey = ['phone-change'] as const;

export function usePendingPhoneChange(enabled = true) {
  return useQuery({
    queryKey: phoneChangeKey,
    queryFn: () => api<{ pending: PendingPhoneChange | null }>('/v1/me/phone-change'),
    enabled,
  });
}

/** Verify the new number by OTP; the switch happens 24 h later (the old number is told and can cancel). */
export function PhoneChangeDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const client = useQueryClient();
  const pending = usePendingPhoneChange(open);
  const [step, setStep] = useState<'number' | 'code'>('number');
  const [mobile, setMobile] = useState('');
  const [code, setCode] = useState('');
  const digits = mobile.replace(/\D/g, '');
  const verification = useRef<VerificationSession | null>(null);
  const start = useMutation({
    mutationFn: async () => {
      const newPhone = `+91${digits}`;
      // The code goes to the *new* number (our SMS, or Firebase).
      verification.current = await startPhoneVerification(newPhone, () => api('/v1/me/phone-change', { method: 'POST', body: { newPhone } }));
    },
    onSuccess: () => setStep('code'),
  });
  const verify = useMutation({
    mutationFn: async (value: string) => {
      const proof: PhoneProof = await verification.current!.confirm(value);
      return api('/v1/me/phone-change/verify', { method: 'POST', body: { newPhone: `+91${digits}`, ...proof } });
    },
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: phoneChangeKey });
      onOpen(false);
    },
  });
  const cancel = useMutation({ mutationFn: () => api('/v1/me/phone-change', { method: 'DELETE' }), onSuccess: () => void client.invalidateQueries({ queryKey: phoneChangeKey }) });
  const error = start.error ?? verify.error;

  // Start over each time the dialog is reopened.
  const onOpen = (next: boolean) => {
    if (!next) {
      setStep('number');
      setMobile('');
      setCode('');
      start.reset();
      verify.reset();
    }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={onOpen} title={t('privacy.changePhone')} description={t('privacy.changePhoneHint')}>
      {pending.data?.pending ? (
        <div className="flex flex-col gap-3 text-sm">
          <p>{t('privacy.phonePending', { phone: formatPhone(pending.data.pending.newPhone), date: new Date(pending.data.pending.effectiveAt).toLocaleString() })}</p>
          <Button variant="outline" onClick={() => cancel.mutate()} disabled={cancel.isPending}>{t('privacy.cancelChange')}</Button>
        </div>
      ) : step === 'number' ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); start.mutate(); }}>
          <TextField label={t('privacy.newNumber')} inputMode="numeric" placeholder="98765 43210" value={mobile} onChange={(e) => setMobile(e.target.value)} autoFocus />
          {error && <p className="text-sm text-danger">{error.message}</p>}
          <Button type="submit" variant="gradient" disabled={!/^[6-9]\d{9}$/.test(digits) || start.isPending}>{t('auth.sendOtp')}</Button>
          <OtpDeliveryNote when="before" />
        </form>
      ) : (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted">{t('auth.sentTo', { target: `+91 ${digits}` })}</p>
          <OtpDeliveryNote when="after" />
          <OtpInput value={code} onChange={setCode} onComplete={(v) => verify.mutate(v)} />
          {error && <p className="text-sm text-danger">{error.message}</p>}
        </div>
      )}
    </Dialog>
  );
}
