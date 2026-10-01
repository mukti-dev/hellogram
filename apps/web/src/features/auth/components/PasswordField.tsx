import { cn } from '@hellogram/ui';
import { Eye, EyeOff } from 'lucide-react';
import { useId, useState } from 'react';
import { t } from '../../../i18n/t.js';

export function PasswordField({
  label,
  value,
  onChange,
  autoComplete,
  hint,
  error,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  hint?: string;
  error?: string | null;
  placeholder?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      <div
        className={cn(
          'flex h-12 items-center rounded-md border bg-surface-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40',
          error ? 'border-danger' : 'border-border',
        )}
      >
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          aria-invalid={error ? true : undefined}
          className="h-full min-w-0 flex-1 bg-transparent px-4 text-base outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? t('auth.hidePassword') : t('auth.showPassword')}
          aria-pressed={visible}
          className="inline-flex size-11 shrink-0 items-center justify-center text-muted hover:text-fg"
        >
          {visible ? <EyeOff className="size-5" aria-hidden /> : <Eye className="size-5" aria-hidden />}
        </button>
      </div>
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
}
