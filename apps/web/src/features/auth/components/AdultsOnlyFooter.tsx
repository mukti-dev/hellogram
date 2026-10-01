import { Link } from 'react-router';
import { t } from '../../../i18n/t.js';

export function AdultsOnlyFooter() {
  return (
    <footer className="mt-8 flex items-center gap-3 text-xs text-muted">
      <span
        aria-label={t('auth.adultsOnly')}
        className="inline-flex size-10 shrink-0 items-center justify-center rounded-full border border-border text-sm font-bold text-fg"
      >
        18+
      </span>
      <p>
        {t('auth.agreePrefix')}{' '}
        <Link to="/terms" className="text-primary underline underline-offset-2">
          {t('auth.terms')}
        </Link>{' '}
        {t('auth.and')}{' '}
        <Link to="/privacy" className="text-primary underline underline-offset-2">
          {t('auth.privacy')}
        </Link>
        .
      </p>
    </footer>
  );
}
