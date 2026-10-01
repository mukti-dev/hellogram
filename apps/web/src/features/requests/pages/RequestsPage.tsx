import { cn } from '@hellogram/ui';
import { ArrowLeft, Inbox, ShieldBan } from 'lucide-react';
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { EmptyState } from '../../../app/layouts/PageHeader.js';
import { t } from '../../../i18n/t.js';
import { RequestCard } from '../components/RequestCard.js';
import { useIncomingRequests, usePendingCount } from '../model/queries.js';

export function RequestsPage() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<'pending' | 'blocked'>('pending');
  const list = useIncomingRequests(tab);
  const pendingCount = usePendingCount().data ?? 0;

  return (
    <div className="mx-auto w-full max-w-2xl px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => navigate('/inbox')}
          aria-label={t('numbers.back')}
          className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <h1 className="text-2xl font-bold tracking-tight">{t('requests.title')}</h1>
      </div>

      <div role="tablist" className="mt-4 grid grid-cols-2 rounded-lg bg-surface-2 p-1">
        {(['pending', 'blocked'] as const).map((key) => (
          <button
            key={key}
            role="tab"
            type="button"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={cn(
              'flex h-10 items-center justify-center gap-2 rounded-md text-sm font-semibold transition',
              tab === key ? 'bg-primary text-white' : 'text-muted hover:text-fg',
            )}
          >
            {t(`requests.${key}`)}
            {key === 'pending' && pendingCount > 0 && (
              <span className="inline-flex size-5 items-center justify-center rounded-full bg-white/25 text-[11px]">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3" role="tabpanel">
        {list.data?.items.map((request) => <RequestCard key={request.id} request={request} />)}
        {list.data?.items.length === 0 &&
          (tab === 'pending' ? (
            <EmptyState icon={<Inbox className="size-6" aria-hidden />} title={t('requests.emptyPending')} hint={t('requests.emptyPendingHint')} />
          ) : (
            <EmptyState icon={<ShieldBan className="size-6" aria-hidden />} title={t('requests.emptyBlocked')} hint={t('requests.emptyBlockedHint')} />
          ))}
      </div>
    </div>
  );
}
