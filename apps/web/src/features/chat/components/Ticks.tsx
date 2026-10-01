import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';

export type TickState = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

/** 🕐 sending → ✓ reached server → ✓✓ delivered to a device → ✓✓ R (blue) read. */
export function Ticks({ state }: { state: TickState }) {
  const label = { pending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[state];
  const common = 'size-3.5';
  return (
    <span role="img" aria-label={label} className="inline-flex items-center">
      {state === 'pending' && <Clock className={common} aria-hidden />}
      {state === 'failed' && <AlertCircle className={`${common} text-red-200`} aria-hidden />}
      {state === 'sent' && <Check className={common} aria-hidden />}
      {state === 'delivered' && <CheckCheck className={common} aria-hidden />}
      {state === 'read' && (
        // The letter makes "read" clear without relying on colour alone.
        <span className="inline-flex items-center gap-0.5 text-sky-300" aria-hidden>
          <CheckCheck className={common} />
          <span className="text-[10px] leading-none font-bold">R</span>
        </span>
      )}
    </span>
  );
}
