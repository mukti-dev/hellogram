import { Card, cn } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { adminApi, fmt } from '../api.js';

interface Ticket {
  id: string;
  complainantContact: string;
  subject: string;
  body: string;
  status: 'open' | 'acknowledged' | 'resolved' | 'closed';
  ackDueAt: string;
  resolveDueAt: string;
  ackAt: string | null;
  resolvedAt: string | null;
  createdAt: string;
  ackOverdue: boolean;
  resolveOverdue: boolean;
}

/** IT Rules 2021: acknowledge within 24 h, resolve within 15 days. */
export function GrievancesPage() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['grievances'], queryFn: () => adminApi<Ticket[]>('/grievances') });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: Ticket['status'] }) => adminApi(`/grievances/${id}`, { method: 'PATCH', body: { status } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['grievances'] }),
  });

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">Grievances</h1>
      <div className="mt-4 flex flex-col gap-3">
        {list.data?.map((g) => (
          <Card key={g.id} className={cn('p-4', (g.ackOverdue || g.resolveOverdue) && 'border-danger')}>
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-semibold">{g.subject}</p>
                <p className="text-xs text-muted">{g.complainantContact} · filed {fmt(g.createdAt)}</p>
              </div>
              <select
                aria-label="Status"
                value={g.status}
                onChange={(e) => update.mutate({ id: g.id, status: e.target.value as Ticket['status'] })}
                className="h-9 rounded-md border border-border bg-surface-2 px-2 text-sm"
              >
                {['open', 'acknowledged', 'resolved', 'closed'].map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
            </div>
            <p className="mt-2 text-sm whitespace-pre-wrap">{g.body}</p>
            <p className="mt-2 text-xs">
              <span className={g.ackOverdue ? 'font-semibold text-danger' : 'text-muted'}>Ack due {fmt(g.ackDueAt)}{g.ackAt && ` · acked ${fmt(g.ackAt)}`}</span>
              {' · '}
              <span className={g.resolveOverdue ? 'font-semibold text-danger' : 'text-muted'}>Resolve due {fmt(g.resolveDueAt)}{g.resolvedAt && ` · resolved ${fmt(g.resolvedAt)}`}</span>
            </p>
          </Card>
        ))}
        {list.data?.length === 0 && <p className="text-sm text-muted">No grievances.</p>}
      </div>
    </div>
  );
}
