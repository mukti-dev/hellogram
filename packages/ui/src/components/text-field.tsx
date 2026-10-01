import { forwardRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { cn } from '../cn.js';

export interface TextFieldProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  hint?: ReactNode;
  error?: string | null;
  hideLabel?: boolean;
}

export const TextField = forwardRef<HTMLInputElement, TextFieldProps>(function TextField(
  { label, hint, error, hideLabel, id, className, ...rest },
  ref,
) {
  const inputId = id ?? `f-${label.replace(/\W+/g, '-').toLowerCase()}`;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className={cn('text-sm font-medium', hideLabel && 'sr-only')}>
        {label}
      </label>
      <input
        ref={ref}
        id={inputId}
        aria-invalid={error ? true : undefined}
        className={cn(
          'h-12 rounded-md border bg-surface-2 px-4 text-base text-fg outline-none placeholder:text-muted',
          'focus:border-primary focus:ring-2 focus:ring-primary/40',
          error ? 'border-danger' : 'border-border',
          className,
        )}
        {...rest}
      />
      {error ? (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      ) : (
        hint && <p className="text-xs text-muted">{hint}</p>
      )}
    </div>
  );
});
