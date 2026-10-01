import { Button, Card, TextField } from '@hellogram/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { adminApi, fmt } from '../api.js';

interface LegalRequest {
  id: string;
  authority: string;
  referenceNo: string;
  scope: string;
  receivedAt: string;
  respondedAt: string | null;
  notes: string | null;
}

/** Takedown / law-enforcement request log (IT Rules 2021). */
export function LegalPage() {
  const client = useQueryClient();
  const list = useQuery({ queryKey: ['legal'], queryFn: () => adminApi<LegalRequest[]>('/legal-requests') });
  const [form, setForm] = useState({ authority: '', referenceNo: '', scope: '', receivedAt: new Date().toISOString().slice(0, 16), notes: '' });
  const create = useMutation({
    mutationFn: () => adminApi('/legal-requests', { method: 'POST', body: { ...form, receivedAt: new Date(form.receivedAt).toISOString(), notes: form.notes || null } }),
    onSuccess: () => {
      setForm((f) => ({ ...f, authority: '', referenceNo: '', scope: '', notes: '' }));
      void client.invalidateQueries({ queryKey: ['legal'] });
    },
  });
  const respond = useMutation({
    mutationFn: (id: string) => adminApi(`/legal-requests/${id}`, { method: 'PATCH', body: { respondedAt: new Date().toISOString() } }),
    onSuccess: () => void client.invalidateQueries({ queryKey: ['legal'] }),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="max-w-4xl">
      <h1 className="text-2xl font-bold">Legal requests</h1>
      <Card className="mt-4 grid grid-cols-2 gap-3 p-4">
        <TextField label="Authority" value={form.authority} onChange={set('authority')} />
        <TextField label="Reference no." value={form.referenceNo} onChange={set('referenceNo')} />
        <TextField label="Scope" value={form.scope} onChange={set('scope')} />
        <TextField label="Received at" type="datetime-local" value={form.receivedAt} onChange={set('receivedAt')} />
        <div className="col-span-2">
          <TextField label="Notes" value={form.notes} onChange={set('notes')} />
        </div>
        <Button className="col-span-2" disabled={!form.authority || !form.referenceNo || !form.scope || create.isPending} onClick={() => create.mutate()}>
          Log request
        </Button>
      </Card>
      <ul className="mt-4 flex flex-col gap-2">
        {list.data?.map((r) => (
          <Card key={r.id} className="flex items-start justify-between gap-4 p-4 text-sm">
            <div>
              <p className="font-semibold">{r.authority} · <span className="font-mono">{r.referenceNo}</span></p>
              <p className="text-muted">{r.scope}</p>
              <p className="text-xs text-muted">Received {fmt(r.receivedAt)} · {r.respondedAt ? `responded ${fmt(r.respondedAt)}` : 'awaiting response'}</p>
              {r.notes && <p className="mt-1 text-xs">{r.notes}</p>}
            </div>
            {!r.respondedAt && (
              <Button size="sm" variant="outline" onClick={() => respond.mutate(r.id)}>Mark responded</Button>
            )}
          </Card>
        ))}
      </ul>
    </div>
  );
}
