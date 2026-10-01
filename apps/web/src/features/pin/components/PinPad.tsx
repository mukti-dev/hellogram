import { cn } from '@hellogram/ui';
import { Delete } from 'lucide-react';
import { useEffect, useRef } from 'react';

/** 4-dot PIN entry with an on-screen keypad and hardware keyboard support. */
export function PinPad({
  value,
  onChange,
  onComplete,
  disabled,
  error,
  length = 4,
}: {
  value: string;
  onChange: (v: string) => void;
  onComplete: (v: string) => void;
  disabled?: boolean;
  error?: boolean;
  length?: number;
}) {
  // A ref keeps fast typing correct: several keydowns can land before React re-renders.
  const current = useRef(value);
  const latest = useRef({ disabled, onChange, onComplete });
  useEffect(() => {
    current.current = value;
    latest.current = { disabled, onChange, onComplete };
  });

  const press = (digit: string) => {
    if (latest.current.disabled || current.current.length >= length) return;
    const next = current.current + digit;
    current.current = next;
    latest.current.onChange(next);
    if (next.length === length) latest.current.onComplete(next);
  };
  const back = () => {
    if (latest.current.disabled) return;
    current.current = current.current.slice(0, -1);
    latest.current.onChange(current.current);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (/^\d$/.test(e.key)) {
        e.preventDefault();
        press(e.key);
      } else if (e.key === 'Backspace') back();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col items-center gap-8">
      <div className={cn('flex gap-4', error && 'animate-[shake_0.3s]')} role="status" aria-label={`${value.length} of ${length} digits entered`}>
        {Array.from({ length }, (_, i) => (
          <span key={i} className={cn('size-3.5 rounded-full border-2 border-fg transition', i < value.length && 'bg-fg', error && 'border-danger bg-danger')} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => press(d)}
            disabled={disabled}
            className="size-16 rounded-2xl bg-surface-2 text-2xl font-semibold transition hover:bg-surface-3 active:scale-95"
          >
            {d}
          </button>
        ))}
        <span />
        <button type="button" onClick={() => press('0')} disabled={disabled} className="size-16 rounded-2xl bg-surface-2 text-2xl font-semibold hover:bg-surface-3 active:scale-95">
          0
        </button>
        <button type="button" onClick={back} aria-label="Delete digit" disabled={disabled} className="inline-flex size-16 items-center justify-center rounded-2xl text-muted hover:bg-surface-2">
          <Delete className="size-6" aria-hidden />
        </button>
      </div>
    </div>
  );
}
