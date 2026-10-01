import { Button, Card, Logo, TextField } from '@hellogram/ui';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2 } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Turnstile, turnstileEnabled } from '../../shared/Turnstile.js';
import { Link } from 'react-router';
import { api } from '../../core/http/client.js';

/** IT Rules 2021 grievance mechanism: officer details + complaint form (ack 24 h, resolve 15 days). */
export function GrievancePage() {
  const officer = useQuery({ queryKey: ['grievance-officer'], queryFn: () => api<{ name: string; email: string }>('/v1/legal/grievance-officer', { auth: false }) });
  const [form, setForm] = useState({ contact: '', subject: '', body: '' });
  const [human, setHuman] = useState<string | null>(null);
  const onToken = useCallback((t: string | null) => setHuman(t), []);
  const submit = useMutation({
    mutationFn: () =>
      api<{ id: string; ackDueAt: string }>('/v1/grievance', {
        method: 'POST',
        body: { ...form, ...(human ? { turnstileToken: human } : {}) },
        auth: false,
      }),
  });

  return (
    <main className="mx-auto min-h-dvh max-w-2xl px-5 py-10">
      <Link to="/" aria-label="Hellogram home">
        <Logo />
      </Link>
      <h1 className="mt-10 text-3xl font-bold tracking-tight">Grievance Officer</h1>
      {officer.data && (
        <p className="mt-3 text-muted">
          {officer.data.name} ·{' '}
          <a href={`mailto:${officer.data.email}`} className="text-primary underline">
            {officer.data.email}
          </a>
        </p>
      )}
      <p className="mt-2 text-sm text-muted">We acknowledge complaints within 24 hours and resolve them within 15 days.</p>

      {submit.data ? (
        <Card className="mt-6 flex items-start gap-3 p-5">
          <CheckCircle2 className="size-6 text-success" aria-hidden />
          <div>
            <p className="font-semibold">Complaint received</p>
            <p className="text-sm text-muted">
              Reference <span className="font-mono">{submit.data.id.slice(0, 8)}</span>. We’ll acknowledge it by {new Date(submit.data.ackDueAt).toLocaleString()}.
            </p>
          </div>
        </Card>
      ) : (
        <form
          className="mt-6 flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            submit.mutate();
          }}
        >
          <TextField label="How can we reach you? (email or phone)" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} required />
          <TextField label="Subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} required />
          <label className="flex flex-col gap-1.5 text-sm font-medium">
            Describe the issue (include the Hellogram number involved, if any)
            <textarea
              rows={6}
              value={form.body}
              onChange={(e) => setForm({ ...form, body: e.target.value })}
              required
              minLength={10}
              className="rounded-md border border-border bg-surface-2 p-3 font-normal outline-none focus:border-primary"
            />
          </label>
          <Turnstile onToken={onToken} />
          {submit.error && <p className="text-sm text-danger">{submit.error.message}</p>}
          <Button type="submit" variant="gradient" disabled={submit.isPending || (turnstileEnabled && !human)}>
            Submit complaint
          </Button>
        </form>
      )}
    </main>
  );
}
