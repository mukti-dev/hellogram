import { Button, Card, Dialog, TextField } from '@hellogram/ui';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Download, FileText, Scale, Trash2 } from 'lucide-react';
import { useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { api } from '../../../core/http/client.js';
import { t } from '../../../i18n/t.js';
import { OtpInput } from '../../auth/components/OtpInput.js';
import { useAuthStore } from '../../auth/model/auth-store.js';
import { useMe } from '../../auth/model/queries.js';
import { startPhoneVerification, type VerificationSession } from '../../../core/phone/verification.js';

async function downloadMyData() {
  const token = useAuthStore.getState().accessToken;
  const res = await fetch('/v1/me/export', { headers: { Authorization: `Bearer ${token}`, 'X-Hellogram-Client': 'web' } });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hellogram-data-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

const Row = ({ icon, label, onClick, to, danger }: { icon: React.ReactNode; label: string; onClick?: () => void; to?: string; danger?: boolean }) => {
  const content = (
    <>
      <span className={danger ? 'text-danger' : 'text-muted'}>{icon}</span>
      <span className={`flex-1 text-sm font-medium ${danger ? 'text-danger' : ''}`}>{label}</span>
      <ChevronRight className="size-4 text-muted" aria-hidden />
    </>
  );
  const cls = 'flex min-h-12 w-full items-center gap-3 rounded-md px-1 text-left hover:bg-surface-2';
  return to ? <Link to={to} className={cls}>{content}</Link> : <button type="button" onClick={onClick} className={cls}>{content}</button>;
};

/** DPDP rights + legal (Settings → Privacy & legal). */
export function PrivacySection() {
  const [deleteOpen, setDeleteOpen] = useState(false);
  const download = useMutation({ mutationFn: downloadMyData });

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{t('privacy.title')}</h2>
      <div className="mt-2 divide-y divide-border">
        <Row icon={<Download className="size-5" />} label={download.isPending ? t('common.loading') : t('privacy.download')} onClick={() => download.mutate()} />
        <Row icon={<FileText className="size-5" />} label={t('auth.terms')} to="/terms" />
        <Row icon={<FileText className="size-5" />} label={t('auth.privacy')} to="/privacy" />
        <Row icon={<FileText className="size-5" />} label={t('privacy.guidelines')} to="/guidelines" />
        <Row icon={<Scale className="size-5" />} label={t('privacy.grievance')} to="/grievance" />
        <Row icon={<Trash2 className="size-5" />} label={t('privacy.deleteAccount')} onClick={() => setDeleteOpen(true)} danger />
      </div>
      {download.error && <p className="mt-2 text-sm text-danger">{download.error.message}</p>}
      <DeleteAccountDialog open={deleteOpen} onOpenChange={setDeleteOpen} />
    </Card>
  );
}

function DeleteAccountDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const navigate = useNavigate();
  const client = useQueryClient();
  const signOut = useAuthStore((s) => s.signOut);
  const [typed, setTyped] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const me = useMe();
  const verification = useRef<VerificationSession | null>(null);
  const send = useMutation({
    mutationFn: async () => {
      // Re-verify the account's own phone before an irreversible delete.
      verification.current = await startPhoneVerification(me.data!.phone, () => api('/v1/me/delete/otp', { method: 'POST' }));
    },
    onSuccess: () => setSent(true),
  });
  const remove = useMutation({
    mutationFn: async (value: string) => {
      const proof = await verification.current!.confirm(value);
      return api('/v1/me', { method: 'DELETE', body: { ...proof, confirm: 'DELETE' } });
    },
    onSuccess: () => {
      signOut();
      client.clear();
      navigate('/login', { replace: true });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={t('privacy.deleteTitle')} description={t('privacy.deleteBody')}>
      <div className="flex flex-col gap-3">
        <TextField label={t('numbers.deleteConfirmLabel')} value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
        {!sent ? (
          <Button variant="danger" disabled={typed !== 'DELETE' || send.isPending || !me.data} onClick={() => send.mutate()}>{t('privacy.sendDeleteCode')}</Button>
        ) : (
          <>
            <p className="text-sm text-muted">{t('pin.codeSent')}</p>
            <OtpInput value={code} onChange={setCode} onComplete={(v) => typed === 'DELETE' && remove.mutate(v)} />
          </>
        )}
        {(send.error ?? remove.error) && <p className="text-sm text-danger">{(send.error ?? remove.error)?.message}</p>}
      </div>
    </Dialog>
  );
}
