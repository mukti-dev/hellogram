import { cn } from '@hellogram/ui';
import { PhoneCall } from 'lucide-react';
import { useOtpDelivery } from '../../../core/phone/delivery.js';
import { t } from '../../../i18n/t.js';

/**
 * Codes can arrive as a voice call (2Factor) — say so, so nobody ignores an unknown caller.
 * "before": next to a Send OTP button. "after": next to the code box once it's on its way.
 * Renders nothing when codes only come by SMS.
 */
export function OtpDeliveryNote({ when, className }: { when: 'before' | 'after'; className?: string }) {
  if (useOtpDelivery() !== 'call_or_sms') return null;
  return (
    <p
      role={when === 'after' ? 'status' : undefined}
      className={cn(
        'flex items-start gap-2.5 rounded-md text-sm',
        when === 'after' ? 'border border-primary/40 bg-primary-soft p-3 text-fg' : 'text-muted',
        className,
      )}
    >
      <PhoneCall className={cn('mt-0.5 size-4 shrink-0', when === 'after' ? 'text-primary' : '')} aria-hidden />
      <span>{when === 'before' ? t('auth.callNoteBefore') : t('auth.callNoteAfter')}</span>
    </p>
  );
}
