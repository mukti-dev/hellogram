import { ArrowRight } from 'lucide-react';
import { Link } from 'react-router';
import { t } from '../../../i18n/t.js';
import { usePendingCount } from '../model/queries.js';

/** "3 new requests · Review now" banner at the top of the inbox. */
export function RequestsBanner() {
  const count = usePendingCount().data ?? 0;
  if (count === 0) return null;
  return (
    <Link
      to="/inbox/requests"
      className="mx-3 flex items-center gap-3 rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm"
    >
      <span className="inline-flex size-6 items-center justify-center rounded-full bg-danger text-xs font-bold text-white">{count}</span>
      <span className="flex-1 font-medium">{count === 1 ? t('requests.bannerOne') : t('requests.banner', { count })}</span>
      <span className="flex items-center gap-1 font-semibold text-label-dating">
        {t('requests.reviewNow')} <ArrowRight className="size-4" aria-hidden />
      </span>
    </Link>
  );
}
