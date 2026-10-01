import type { CallLogEntryDto } from '@hellogram/shared';
import { Avatar, FilterChip, LabelChip, cn } from '@hellogram/ui';
import { useQuery } from '@tanstack/react-query';
import { Phone, PhoneIncoming, PhoneMissed, PhoneOutgoing } from 'lucide-react';
import { useState } from 'react';
import { EmptyState, PageHeader } from '../../../app/layouts/PageHeader.js';
import { t } from '../../../i18n/t.js';
import { clockTime, dayLabel, labelName } from '../../../shared/format.js';
import { useNumbers } from '../../numbers/model/queries.js';
import { callsApi } from '../api/calls.api.js';
import { useCallStore } from '../model/call-store.js';

const duration = (s: number | null) => (s === null ? '' : ` · ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`);

/** Screen 13: call log grouped by day, filter by number. */
export function CallsPage() {
  const [personaId, setPersonaId] = useState<string | undefined>();
  const numbers = useNumbers().data?.items ?? [];
  const log = useQuery({ queryKey: ['calls', personaId ?? 'all'], queryFn: () => callsApi.log(personaId) });
  const start = useCallStore((s) => s.startOutgoing);

  const groups = new Map<string, CallLogEntryDto[]>();
  for (const entry of log.data?.items ?? []) {
    const key = dayLabel(entry.startedAt);
    groups.set(key, [...(groups.get(key) ?? []), entry]);
  }

  return (
    <div className="mx-auto w-full max-w-3xl pb-10">
      <PageHeader title={t('calls.title')} />
      <div className="no-scrollbar flex gap-2 overflow-x-auto px-4 pb-3 lg:px-8" role="toolbar" aria-label="Filter by number">
        <FilterChip selected={!personaId} onClick={() => setPersonaId(undefined)}>
          {t('calls.all')}
        </FilterChip>
        {numbers.map((n) => (
          <FilterChip key={n.id} selected={personaId === n.id} onClick={() => setPersonaId(n.id)}>
            {n.displayName}
          </FilterChip>
        ))}
      </div>

      {log.isSuccess && groups.size === 0 && (
        <EmptyState icon={<Phone className="size-6" aria-hidden />} title={t('calls.empty')} hint={t('calls.emptyHint')} />
      )}

      {[...groups.entries()].map(([day, entries]) => (
        <section key={day} className="px-4 lg:px-8">
          <h2 className="mt-4 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">{day}</h2>
          <ul className="divide-y divide-border rounded-lg border border-border bg-surface-1">
            {entries.map((e) => {
              const missed = e.outcome === 'missed';
              const Icon = missed ? PhoneMissed : e.direction === 'incoming' ? PhoneIncoming : PhoneOutgoing;
              return (
                <li key={e.id} className="flex items-center gap-3 px-3 py-3">
                  <Avatar name={e.counterpart.displayName} src={e.counterpart.avatarUrl} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className={cn('truncate text-sm font-semibold', missed && 'text-danger')}>{e.counterpart.displayName}</p>
                      <LabelChip kind={e.me.labelKind} text={labelName(e.me)} prefix={t('chat.via')} />
                    </div>
                    <p className="flex items-center gap-1.5 text-xs text-muted">
                      <Icon className={cn('size-3.5', missed ? 'text-danger' : 'text-muted')} aria-hidden />
                      {t(`calls.outcome.${e.outcome}`)}
                      {duration(e.durationSeconds)} · {clockTime(e.startedAt)}
                    </p>
                  </div>
                  <button
                    type="button"
                    aria-label={`${t('calls.callBack')} ${e.counterpart.displayName}`}
                    onClick={() =>
                      void start(e.conversationId, {
                        name: e.counterpart.displayName,
                        avatarUrl: e.counterpart.avatarUrl,
                        labelKind: e.me.labelKind,
                        labelText: e.me.labelText,
                        code: e.counterpart.code,
                      })
                    }
                    className="inline-flex size-11 items-center justify-center rounded-full text-success hover:bg-surface-2"
                  >
                    <Phone className="size-5" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
