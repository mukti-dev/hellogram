import { cn } from '@hellogram/ui';
import { t } from '../../../i18n/t.js';

export const mobileDigits = (value: string) => value.replace(/\D/g, '');
export const isValidMobile = (value: string) => /^[6-9]\d{9}$/.test(mobileDigits(value));

/** +91 mobile number input, as in the login design. */
export function MobileField({
  value,
  onChange,
  error,
  autoFocus,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
  autoFocus?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="mobile" className="text-sm font-medium">
        {t('auth.mobileLabel')}
      </label>
      <div
        className={cn(
          'flex h-12 items-center rounded-md border bg-surface-2 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/40',
          error ? 'border-danger' : 'border-border',
        )}
      >
        <span className="flex h-full items-center border-r border-border px-4 font-semibold">{t('auth.countryCode')}</span>
        <input
          id="mobile"
          type="tel"
          inputMode="numeric"
          autoComplete="tel-national"
          placeholder={t('auth.mobilePlaceholder')}
          value={value}
          onChange={(e) => onChange(e.target.value.replace(/[^\d\s]/g, '').slice(0, 11))}
          aria-invalid={error ? true : undefined}
          className="h-full min-w-0 flex-1 bg-transparent px-4 text-base outline-none placeholder:text-muted"
          autoFocus={autoFocus}
        />
      </div>
      {error && (
        <p className="text-xs font-medium text-danger" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
