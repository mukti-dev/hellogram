import { cn } from '@hellogram/ui';
import { useRef, type ClipboardEvent, type KeyboardEvent } from 'react';
import { t } from '../../../i18n/t.js';

export interface OtpInputProps {
  value: string;
  onChange: (value: string) => void;
  onComplete?: (value: string) => void;
  length?: number;
  disabled?: boolean;
  invalid?: boolean;
}

/** Six boxes with auto-advance, backspace-to-previous, arrow keys and paste support. */
export function OtpInput({ value, onChange, onComplete, length = 6, disabled, invalid }: OtpInputProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const update = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  const focus = (index: number) => refs.current[Math.max(0, Math.min(length - 1, index))]?.focus();

  const onInput = (index: number, raw: string) => {
    const typed = raw.replace(/\D/g, '');
    if (!typed) return;
    // Mobile autofill can drop the whole code into one box.
    const next = update(value.slice(0, index) + typed + value.slice(index + typed.length));
    focus(Math.min(index + typed.length, next.length));
  };

  const onKeyDown = (index: number, event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (digits[index]) {
        update(value.slice(0, index) + value.slice(index + 1));
      } else if (index > 0) {
        update(value.slice(0, index - 1) + value.slice(index));
        focus(index - 1);
      }
    } else if (event.key === 'ArrowLeft') {
      focus(index - 1);
    } else if (event.key === 'ArrowRight') {
      focus(index + 1);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    event.preventDefault();
    const next = update(event.clipboardData.getData('text'));
    focus(next.length);
  };

  return (
    <div className="flex justify-between gap-2 sm:gap-3" role="group" aria-label="One-time code">
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => {
            refs.current[index] = el;
          }}
          value={digit}
          onChange={(e) => onInput(index, e.target.value)}
          onKeyDown={(e) => onKeyDown(index, e)}
          onPaste={onPaste}
          onFocus={(e) => e.target.select()}
          inputMode="numeric"
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          disabled={disabled}
          aria-label={t('auth.otpLabel', { n: index + 1 })}
          aria-invalid={invalid || undefined}
          autoFocus={index === 0}
          className={cn(
            'h-14 w-full min-w-0 rounded-md border bg-surface-2 text-center font-mono text-xl font-semibold text-fg outline-none transition',
            'focus:border-primary focus:ring-2 focus:ring-primary/40',
            invalid ? 'border-danger' : 'border-border',
          )}
        />
      ))}
    </div>
  );
}
