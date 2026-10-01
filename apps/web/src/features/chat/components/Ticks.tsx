import { Check, CheckCheck, Clock, AlertCircle } from 'lucide-react';

export type TickState = 'pending' | 'failed' | 'sent' | 'delivered' | 'read';

/** 🕐 sending → ✓ reached server → ✓✓ delivered to a device → ✓✓ (blue) read. */
export function Ticks({ state }: { state: TickState }) {
  const label = { pending: 'Sending', failed: 'Not sent', sent: 'Sent', delivered: 'Delivered', read: 'Read' }[state];
  const common = 'size-3.5';
  return (
    <span role="img" aria-label={label} className="inline-flex">
      {state === 'pending' && <Clock className={common} aria-hidden />}
      {state === 'failed' && <AlertCircle className={`${common} text-red-200`} aria-hidden />}
      {state === 'sent' && <Check className={common} aria-hidden />}
      {state === 'delivered' && <CheckCheck className={common} aria-hidden />}
      {state === 'read' && <CheckCheck className={`${common} text-sky-300`} aria-hidden />}
    </span>
  );
}
