import { Button, Card, FilterChip, cn } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';
import { adminApi, fmt } from '../api.js';

type Status = 'open' | 'reviewing' | 'actioned' | 'dismissed';

interface Report {
  id: string;
  reason: string;
  status: Status;
  note: string | null;
  createdAt: string;
  reporterCode: string;
  reportedCode: string;
  reportedDisplayName: string;
  reportedAccountId: string;
}
interface ReportDetail extends Report {
  alsoBlocked: boolean;
  evidence: { at: string; senderCode: string; senderDisplayName: string; type: string; body: string | null; deleted: boolean; suppressed: boolean }[];
}

export function ReportsPage() {
  const [status, setStatus] = useState<Status | undefined>('open');
  const [selected, setSelected] = useState<string | null>(null);
  const reports = useQuery({ queryKey: ['reports', status], queryFn: () => adminApi<Report[]>(`/reports${status ? `?status=${status}` : ''}`) });

  return (
    <div className="flex gap-6">
      <div className="w-[420px] shrink-0">
        <h1 className="text-2xl font-bold">Reports</h1>
        <div className="mt-4 flex flex-wrap gap-2">
          {(['open', 'reviewing', 'actioned', 'dismissed', undefined] as const).map((s) => (
            <FilterChip key={s ?? 'all'} selected={status === s} onClick={() => setStatus(s)}>
              {s ?? 'all'}
            </FilterChip>
          ))}
        </div>
        <ul className="mt-4 flex flex-col gap-2">
          {reports.data?.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => setSelected(r.id)}
                className={cn('w-full rounded-lg border p-3 text-left text-sm', selected === r.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface-1 hover:bg-surface-2')}
              >
                <p className="font-semibold capitalize">{r.reason.replace('_', ' ')} · <span className="font-mono">{r.reportedCode}</span></p>
                <p className="text-xs text-muted">{fmt(r.createdAt)} · {r.status}</p>
                {r.note && <p className="mt-1 line-clamp-2 text-xs">{r.note}</p>}
              </button>
            </li>
          ))}
          {reports.data?.length === 0 && <p className="text-sm text-muted">Nothing here.</p>}
        </ul>
      </div>
      <div className="min-w-0 flex-1">{selected && <ReportDetailView id={selected} />}</div>
    </div>
  );
}

function ReportDetailView({ id }: { id: string }) {
  const client = useQueryClient();
  const report = useQuery({ queryKey: ['report', id], queryFn: () => adminApi<ReportDetail>(`/reports/${id}`) });
  const update = useMutation({
    mutationFn: (status: Status) => adminApi(`/reports/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => {
      void client.invalidateQueries({ queryKey: ['reports'] });
      void client.invalidateQueries({ queryKey: ['report', id] });
    },
  });
  const r = report.data;
  if (!r) return null;
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold capitalize">{r.reason.replace('_', ' ')}</h2>
          <p className="text-sm text-muted">
            <span className="font-mono">{r.reporterCode}</span> reported <span className="font-mono">{r.reportedCode}</span> ({r.reportedDisplayName}) · {fmt(r.createdAt)}
            {r.alsoBlocked && ' · blocked'}
          </p>
          {r.note && <p className="mt-2 text-sm">“{r.note}”</p>}
        </div>
        <Link to={`/lookup?accountId=${r.reportedAccountId}&report=${r.id}`} className="shrink-0 text-sm font-semibold text-primary">
          Open account →
        </Link>
      </div>
      <h3 className="mt-5 text-sm font-semibold">Evidence (last {r.evidence.length} messages)</h3>
      <ol className="mt-2 max-h-[50vh] overflow-y-auto rounded-md border border-border bg-bg p-3 text-sm">
        {r.evidence.map((m, i) => (
          <li key={i} className={cn('py-1', m.senderCode === r.reportedCode ? 'text-fg' : 'text-muted')}>
            <span className="font-mono text-xs">{new Date(m.at).toLocaleString()}</span>{' '}
            <span className="font-semibold">{m.senderDisplayName}</span>
            {m.type === 'intro' && <span className="text-xs"> (intro)</span>}: {m.deleted ? <em>deleted</em> : (m.body ?? <em>purged</em>)}
            {m.suppressed && <span className="text-xs text-warning"> [not delivered]</span>}
          </li>
        ))}
      </ol>
      <div className="mt-4 flex gap-2">
        {(['reviewing', 'actioned', 'dismissed'] as const).map((s) => (
          <Button key={s} size="sm" variant={s === 'actioned' ? 'danger' : 'outline'} disabled={update.isPending || r.status === s} onClick={() => update.mutate(s)}>
            Mark {s}
          </Button>
        ))}
      </div>
    </Card>
  );
}
