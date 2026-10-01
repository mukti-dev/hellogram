import type { LabelKind } from '@hellogram/shared';
import { FilterChip, LabelChip } from '@hellogram/ui';
import { Lock, MessageSquareText, Search, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { EmptyState } from '../../../app/layouts/PageHeader.js';
import { t } from '../../../i18n/t.js';
import { labelName } from '../../../shared/format.js';
import { useNumbers } from '../../numbers/model/queries.js';
import { openUnlock } from '../../pin/model/unlock-ui.js';
import { RequestsBanner } from '../../requests/components/RequestsBanner.js';
import type { InboxFilter } from '../api/chat.api.js';
import { useInbox } from '../model/queries.js';
import { ConversationRow } from './ConversationRow.js';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/** Unified inbox across all numbers (screen 7). */
export function ConversationList() {
  const [label, setLabel] = useState<LabelKind | undefined>();
  const [unread, setUnread] = useState(false);
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const query = useDebounced(q.trim(), 250);
  const filter: InboxFilter = { label, unread, q: query || undefined };
  const inbox = useInbox(filter);
  const numbers = useNumbers().data?.items;

  const labels = useMemo(() => {
    const seen = new Map<LabelKind, { labelKind: LabelKind; labelText: string | null }>();
    for (const n of numbers ?? []) if (!seen.has(n.labelKind)) seen.set(n.labelKind, n);
    return [...seen.values()];
  }, [numbers]);

  const items = inbox.data?.pages.flatMap((p) => p.items) ?? [];
  const locked = inbox.data?.pages[0]?.locked ?? [];

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between px-4 pt-5 pb-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('inbox.title')}</h1>
        <button
          type="button"
          aria-label={t('inbox.search')}
          aria-expanded={searching}
          onClick={() => {
            setSearching((s) => !s);
            setQ('');
          }}
          className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          {searching ? <X className="size-5" aria-hidden /> : <Search className="size-5" aria-hidden />}
        </button>
      </div>

      {searching && (
        <div className="px-4 pb-3">
          <label htmlFor="inbox-search" className="sr-only">
            {t('chat.search')}
          </label>
          <input
            id="inbox-search"
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('chat.search')}
            className="h-11 w-full rounded-md border border-border bg-surface-2 px-4 text-sm outline-none placeholder:text-muted focus:border-primary"
          />
        </div>
      )}

      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3" role="toolbar" aria-label="Filters">
        <FilterChip selected={!label && !unread} onClick={() => { setLabel(undefined); setUnread(false); }}>
          {t('inbox.filters.all')}
        </FilterChip>
        {labels.map((l) => (
          <FilterChip key={l.labelKind} selected={label === l.labelKind} onClick={() => setLabel(label === l.labelKind ? undefined : l.labelKind)}>
            <LabelChip kind={l.labelKind} text={labelName(l)} className="bg-transparent px-0 text-sm" />
          </FilterChip>
        ))}
        <FilterChip selected={unread} onClick={() => setUnread((u) => !u)}>
          {t('inbox.filters.unread')}
        </FilterChip>
      </div>

      <div className="pb-2">
        <RequestsBanner />
      </div>

      <div className="flex-1 overflow-y-auto px-2 pb-24 lg:pb-4">
        {locked.map((n) => (
          <button
            key={n.personaId}
            type="button"
            onClick={() => openUnlock(n.personaId)}
            className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left hover:bg-surface-2"
          >
            <span className="inline-flex size-12 items-center justify-center rounded-full bg-surface-3 text-muted">
              <Lock className="size-5" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2">
                <span className="truncate text-sm font-semibold">{n.displayName}</span>
                <LabelChip kind={n.labelKind} text={labelName(n)} />
              </span>
              <span className="flex items-center gap-1 text-sm text-muted">
                <Lock className="size-3" aria-hidden /> {t('chat.locked')}
              </span>
            </span>
          </button>
        ))}

        {items.map((c) => (
          <ConversationRow key={c.id} conversation={c} />
        ))}

        {inbox.hasNextPage && (
          <button type="button" onClick={() => void inbox.fetchNextPage()} className="w-full py-3 text-sm text-primary">
            {t('common.more')}
          </button>
        )}

        {inbox.isSuccess && items.length === 0 && locked.length === 0 && (
          query ? (
            <p className="py-10 text-center text-sm text-muted">{t('chat.noResults')}</p>
          ) : (
            <EmptyState icon={<MessageSquareText className="size-6" aria-hidden />} title={t('inbox.empty')} hint={t('inbox.emptyHint')} />
          )
        )}
      </div>
    </div>
  );
}
