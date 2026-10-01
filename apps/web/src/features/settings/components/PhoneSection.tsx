import { Button, Card } from '@hellogram/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, Smartphone } from 'lucide-react';
import { useState } from 'react';
import { api } from '../../../core/http/client.js';
import { t } from '../../../i18n/t.js';
import { formatPhone, useMe } from '../../auth/model/queries.js';
import { PhoneChangeDialog, phoneChangeKey, usePendingPhoneChange } from './PhoneChangeDialog.js';

/** The account's real mobile number — private, never shown to anyone. */
export function PhoneSection() {
  const me = useMe();
  const client = useQueryClient();
  const pending = usePendingPhoneChange();
  const [open, setOpen] = useState(false);
  const cancel = useMutation({
    mutationFn: () => api('/v1/me/phone-change', { method: 'DELETE' }),
    onSuccess: () => void client.invalidateQueries({ queryKey: phoneChangeKey }),
  });
  const change = pending.data?.pending;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-3">
        <Smartphone className="mt-0.5 size-5 text-muted" aria-hidden />
        <div className="flex-1">
          <h2 className="text-sm font-semibold">{t('account.phone')}</h2>
          <p className="mt-1 font-medium">{me.data ? formatPhone(me.data.phone) : '—'}</p>
          <p className="text-xs text-muted">{t('account.phoneHint')}</p>

          {change ? (
            <div className="mt-3 flex flex-col gap-2 rounded-md border border-border bg-surface-2 p-3 text-sm sm:flex-row sm:items-center">
              <Clock className="size-4 shrink-0 text-muted" aria-hidden />
              <p className="flex-1">
                {t('privacy.phonePending', { phone: formatPhone(change.newPhone), date: new Date(change.effectiveAt).toLocaleString() })}
              </p>
              <Button variant="outline" size="sm" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
                {t('privacy.cancelChange')}
              </Button>
            </div>
          ) : (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setOpen(true)}>
              {t('privacy.changePhone')}
            </Button>
          )}
        </div>
      </div>
      <PhoneChangeDialog open={open} onOpenChange={setOpen} />
    </Card>
  );
}
