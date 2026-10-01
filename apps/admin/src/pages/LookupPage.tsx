import { Button, Card, TextField } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { adminApi, fmt } from '../api.js';
import { useMe } from '../Layout.js';

interface Lookup {
  accountId: string;
  phone: string;
  email: string | null;
  status: string;
  suspendedUntil: string | null;
  createdAt: string;
  personas: { id: string; code: string; displayName: string; status: string; createdAt: string }[];
  reportsAgainst: number;
  actions: { action: string; reason: string; createdAt: string; until: string | null }[];
}

/** Every lookup is written to the audit log by the API. */
export function LookupPage() {
  const [params, setParams] = useSearchParams();
  const [code, setCode] = useState(params.get('code') ?? '');
  const query = params.get('code') ? `code=${params.get('code')}` : params.get('accountId') ? `accountId=${params.get('accountId')}` : null;
  const result = useQuery({ queryKey: ['lookup', query], queryFn: () => adminApi<Lookup>(`/lookup?${query}`), enabled: Boolean(query) });

  return (
    <div className="max-w-3xl">
      <h1 className="text-2xl font-bold">Account lookup</h1>
      <p className="text-sm text-muted">Viewing account-level data is audited.</p>
      <form
        className="mt-4 flex items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setParams({ code: code.trim().toUpperCase() });
        }}
      >
        <div className="flex-1">
          <TextField label="Hellogram number" placeholder="A482719K" value={code} onChange={(e) => setCode(e.target.value)} className="font-mono" />
        </div>
        <Button type="submit" className="h-12">Look up</Button>
      </form>
      {result.error && <p className="mt-4 text-sm text-danger">{result.error.message}</p>}
      {result.data && <AccountCard data={result.data} reportId={params.get('report')} />}
    </div>
  );
}

function AccountCard({ data, reportId }: { data: Lookup; reportId: string | null }) {
  const me = useMe().data;
  const client = useQueryClient();
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(72);
  const act = useMutation({
    mutationFn: (action: string) =>
      adminApi(`/accounts/${data.accountId}/actions`, {
        method: 'POST',
        body: { action, reason, ...(action === 'suspend' ? { untilHours: hours } : {}), ...(reportId ? { reportId } : {}) },
      }),
    onSuccess: () => {
      setReason('');
      void client.invalidateQueries({ queryKey: ['lookup'] });
    },
  });
  const canBan = me?.role === 'admin';

  return (
    <Card className="mt-6 p-5">
      <dl className="grid grid-cols-[160px_1fr] gap-y-2 text-sm">
        <dt className="text-muted">Account</dt>
        <dd className="font-mono text-xs">{data.accountId}</dd>
        <dt className="text-muted">Phone</dt>
        <dd>{data.phone}</dd>
        <dt className="text-muted">Email</dt>
        <dd>{data.email ?? '—'}</dd>
        <dt className="text-muted">Status</dt>
        <dd className="font-semibold capitalize">
          {data.status}
          {data.suspendedUntil && ` until ${fmt(data.suspendedUntil)}`}
        </dd>
        <dt className="text-muted">Joined</dt>
        <dd>{fmt(data.createdAt)}</dd>
        <dt className="text-muted">Reports against</dt>
        <dd>{data.reportsAgainst}</dd>
      </dl>
      <h3 className="mt-5 text-sm font-semibold">Numbers</h3>
      <ul className="mt-1 text-sm">
        {data.personas.map((p) => (
          <li key={p.id} className="flex gap-3 py-1">
            <span className="font-mono">{p.code}</span>
            <span>{p.displayName}</span>
            <span className="text-muted">{p.status}</span>
          </li>
        ))}
      </ul>
      <h3 className="mt-5 text-sm font-semibold">Action</h3>
      <div className="mt-2 flex flex-col gap-2">
        <TextField label="Reason (required)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <label className="flex items-center gap-2 text-sm">
          Suspend for
          <input type="number" min={1} max={8760} value={hours} onChange={(e) => setHours(Number(e.target.value))} className="h-9 w-24 rounded-md border border-border bg-surface-2 px-2" />
          hours
        </label>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!reason || act.isPending} onClick={() => act.mutate('warn')}>Warn</Button>
          <Button size="sm" variant="outline" disabled={!reason || act.isPending} onClick={() => act.mutate('suspend')}>Suspend</Button>
          <Button size="sm" variant="outline" disabled={!reason || act.isPending} onClick={() => act.mutate('unsuspend')}>Unsuspend</Button>
          {canBan && <Button size="sm" variant="danger" disabled={!reason || act.isPending} onClick={() => act.mutate('ban')}>Ban</Button>}
          {canBan && <Button size="sm" variant="outline" disabled={!reason || act.isPending} onClick={() => act.mutate('unban')}>Unban</Button>}
        </div>
        {act.error && <p className="text-sm text-danger">{act.error.message}</p>}
      </div>
      <h3 className="mt-5 text-sm font-semibold">History</h3>
      <ul className="mt-1 text-sm">
        {data.actions.map((a, i) => (
          <li key={i} className="py-1">
            <span className="font-semibold capitalize">{a.action}</span> · {fmt(a.createdAt)} · {a.reason}
          </li>
        ))}
        {data.actions.length === 0 && <li className="text-muted">No actions yet.</li>}
      </ul>
    </Card>
  );
}
