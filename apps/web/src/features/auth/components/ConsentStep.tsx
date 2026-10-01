import { Button } from '@hellogram/ui';
import { useState } from 'react';
import { Link } from 'react-router';
import { t } from '../../../i18n/t.js';
import { FormError } from './FormError.js';

export interface ConsentStepProps {
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}

/** Shown once, to new accounts only (rule 2): 18+ declaration + Terms/Privacy consent. */
export function ConsentStep({ pending, error, onConfirm }: ConsentStepProps) {
  const [adult, setAdult] = useState(false);
  const [terms, setTerms] = useState(false);

  const checkbox = 'mt-0.5 size-5 shrink-0 rounded border-border accent-[var(--hg-primary)]';

  return (
    <div>
      <span className="inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-lg font-bold text-primary">
        18+
      </span>
      <h1 className="mt-5 text-2xl font-bold tracking-tight">{t('auth.consentTitle')}</h1>
      <p className="mt-1 text-sm text-muted">{t('auth.consentBody')}</p>

      <form
        className="mt-8 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (adult && terms) onConfirm();
        }}
      >
        <label className="flex cursor-pointer gap-3 rounded-md border border-border bg-surface-2 p-4 text-sm">
          <input type="checkbox" className={checkbox} checked={adult} onChange={(e) => setAdult(e.target.checked)} />
          {t('auth.confirmAge')}
        </label>
        <label className="flex cursor-pointer gap-3 rounded-md border border-border bg-surface-2 p-4 text-sm">
          <input type="checkbox" className={checkbox} checked={terms} onChange={(e) => setTerms(e.target.checked)} />
          <span>
            {t('auth.acceptTerms')} (
            <Link to="/terms" target="_blank" className="text-primary underline">
              {t('auth.terms')}
            </Link>
            ,{' '}
            <Link to="/privacy" target="_blank" className="text-primary underline">
              {t('auth.privacy')}
            </Link>
            )
          </span>
        </label>
        <FormError message={error} />
        <Button type="submit" variant="gradient" size="lg" fullWidth disabled={!adult || !terms || pending}>
          {t('auth.createAccount')}
        </Button>
      </form>
    </div>
  );
}
