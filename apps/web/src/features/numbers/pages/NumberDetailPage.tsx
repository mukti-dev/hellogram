import { RETENTION_OPTIONS, type OwnPersonaDto, type Retention } from '@hellogram/shared';
import { Avatar, Button, Card, Dialog, DropdownMenu, LabelChip, NumberCode, Switch, TextField, cn } from '@hellogram/ui';
import {
  ArrowLeft,
  Bell,
  Camera,
  CheckCheck,
  ChevronRight,
  Clock,
  Copy,
  EllipsisVertical,
  Lock,
  MessageCircleQuestion,
  Moon,
  Pause,
  Pencil,
  Phone,
  Play,
  Share2,
  Trash2,
} from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';
import { t } from '../../../i18n/t.js';
import { PinSettingsRow } from '../../pin/components/PinSettingsRow.js';
import { DeleteNumberDialog } from '../components/DeleteNumberDialog.js';
import { labelOf, useAvatar, useNumber, usePauseResume, useShare, useUpdateNumber } from '../model/queries.js';

/** "Until I turn it off" for DND. */
const DND_FOREVER = '2099-12-31T00:00:00.000Z';

function useCopy() {
  const [copied, setCopied] = useState<string | null>(null);
  return {
    copied,
    copy: async (key: string, text: string) => {
      try {
        await navigator.clipboard.writeText(text);
        setCopied(key);
        setTimeout(() => setCopied(null), 1500);
      } catch {
        /* clipboard blocked — ignore */
      }
    },
  };
}

function ToggleRow({ icon, label, hint, checked, onChange, disabled }: {
  icon: ReactNode;
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-2">
      <span className="text-muted">{icon}</span>
      <div className="flex-1">
        <p className="text-sm font-medium">{label}</p>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} label={label} disabled={disabled} />
    </div>
  );
}

export function NumberDetailPage() {
  const { id = '' } = useParams();
  const { data: number, isError } = useNumber(id);
  if (isError) return <Navigate to="/numbers" replace />;
  if (!number) return <p className="p-8 text-center text-sm text-muted">{t('common.loading')}</p>;
  return <NumberDetail number={number} />;
}

function NumberDetail({ number }: { number: OwnPersonaDto }) {
  const navigate = useNavigate();
  const update = useUpdateNumber(number.id);
  const avatar = useAvatar(number.id);
  const pauseResume = usePauseResume(number.id);
  const share = useShare(number.id);
  const { copied, copy } = useCopy();
  const fileRef = useRef<HTMLInputElement>(null);
  const [editingName, setEditingName] = useState(false);
  const [name, setName] = useState(number.displayName);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const url = share.data?.url ?? '';
  const qrSrc = share.data ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(share.data.qrSvg)}` : null;
  const dndOn = Boolean(number.dndUntil && new Date(number.dndUntil) > new Date());

  const nativeShare = async () => {
    const text = t('numbers.shareText', { url });
    if (navigator.share) {
      try {
        await navigator.share({ title: number.displayName, text, url });
      } catch {
        /* dismissed */
      }
    } else {
      await copy('link', url);
    }
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 pt-4 pb-10 lg:px-8 lg:pt-8">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => navigate('/numbers')}
          aria-label={t('numbers.back')}
          className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
        >
          <ArrowLeft className="size-5" aria-hidden />
        </button>
        <DropdownMenu
          trigger={
            <button
              type="button"
              aria-label={t('numbers.moreActions', { name: number.displayName })}
              className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
            >
              <EllipsisVertical className="size-5" aria-hidden />
            </button>
          }
          items={[
            { label: t('numbers.changePhoto'), icon: <Camera className="size-4" />, onSelect: () => fileRef.current?.click() },
            ...(number.avatarUrl
              ? [{ label: t('numbers.removePhoto'), icon: <Trash2 className="size-4" />, onSelect: () => avatar.mutate(null) }]
              : []),
            number.status === 'paused'
              ? {
                  label: t('numbers.resume'),
                  icon: <Play className="size-4" />,
                  disabled: number.pauseReason !== 'user',
                  onSelect: () => pauseResume.mutate('resume'),
                }
              : { label: t('numbers.pause'), icon: <Pause className="size-4" />, onSelect: () => pauseResume.mutate('pause') },
            { label: t('numbers.delete'), icon: <Trash2 className="size-4" />, danger: true, onSelect: () => setConfirmDelete(true) },
          ]}
        />
      </div>

      {/* Identity */}
      <div className="flex flex-col items-center text-center">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          aria-label={t('numbers.changePhoto')}
          className="group relative rounded-full"
        >
          <Avatar name={number.displayName} src={number.avatarUrl} size={96} />
          <span className="absolute right-0 bottom-0 inline-flex size-8 items-center justify-center rounded-full border-2 border-bg bg-primary text-white">
            <Camera className="size-4" aria-hidden />
          </span>
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) avatar.mutate(file);
            e.target.value = '';
          }}
        />
        {avatar.error && <p className="mt-2 text-xs text-danger">{avatar.error.message}</p>}
        <LabelChip kind={number.labelKind} text={labelOf(number)} className="mt-3" />
        <div className="mt-2 flex items-center gap-1.5">
          <h1 className="text-xl font-bold">{number.displayName}</h1>
          <button
            type="button"
            onClick={() => {
              setName(number.displayName);
              setEditingName(true);
            }}
            aria-label={t('numbers.editName')}
            className="inline-flex size-9 items-center justify-center rounded-full text-primary hover:bg-surface-2"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        </div>
        {number.status === 'paused' && (
          <p className="mt-1 text-xs font-semibold text-warning">
            {number.pauseReason === 'user' ? t('numbers.status.paused') : t('numbers.pausedBilling')}
          </p>
        )}
      </div>

      {/* Code */}
      <Card className="mt-5 flex items-center justify-center gap-3 bg-surface-2 py-4">
        <NumberCode code={number.code} className="text-3xl font-medium" />
        <button
          type="button"
          onClick={() => copy('code', number.code)}
          aria-label={t('numbers.copyCode')}
          className="inline-flex size-10 items-center justify-center rounded-full text-primary hover:bg-surface-3"
        >
          {copied === 'code' ? <CheckCheck className="size-5" aria-hidden /> : <Copy className="size-5" aria-hidden />}
        </button>
      </Card>

      {/* QR + link */}
      <div className="mt-5 flex flex-col items-center">
        <div className="rounded-lg bg-white p-3">
          {qrSrc ? (
            <img src={qrSrc} alt={t('numbers.shareThis')} className="size-40" />
          ) : (
            <div className="size-40" />
          )}
        </div>
        <p className="mt-2 text-sm text-muted">{t('numbers.shareThis')}</p>
      </div>
      <Card className="mt-4 flex items-center gap-2 bg-surface-2 px-4 py-3">
        <span className="min-w-0 flex-1 truncate text-center text-sm">{url.replace(/^https?:\/\//, '')}</span>
        <button
          type="button"
          onClick={() => copy('link', url)}
          aria-label={t('numbers.copyLink')}
          className="inline-flex size-9 items-center justify-center rounded-full text-primary hover:bg-surface-3"
        >
          {copied === 'link' ? <CheckCheck className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        </button>
      </Card>
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Button variant="gradient" onClick={nativeShare} leftIcon={<Share2 className="size-4" aria-hidden />}>
          {t('numbers.share')}
        </Button>
        <Button variant="outline" onClick={() => copy('link', url)} leftIcon={<Copy className="size-4" aria-hidden />}>
          {copied === 'link' ? t('numbers.copied') : t('numbers.copyLink')}
        </Button>
      </div>

      {/* Settings */}
      <Card className="mt-5 divide-y divide-border px-4">
        <div>
          <ToggleRow
            icon={<Bell className="size-5" aria-hidden />}
            label={t('numbers.acceptRequests')}
            checked={number.acceptRequests}
            onChange={(v) => update.mutate({ acceptRequests: v })}
          />
          <ToggleRow
            icon={<Phone className="size-5" aria-hidden />}
            label={t('numbers.allowCalls')}
            checked={number.allowCalls}
            onChange={(v) => update.mutate({ allowCalls: v })}
          />
          <ToggleRow
            icon={<MessageCircleQuestion className="size-5" aria-hidden />}
            label={t('numbers.readReceipts')}
            checked={number.readReceipts}
            onChange={(v) => update.mutate({ readReceipts: v })}
          />
        </div>
        <div>
          <PinSettingsRow number={number} icon={<Lock className="size-5" aria-hidden />} />
          <ToggleRow
            icon={<Moon className="size-5" aria-hidden />}
            label={t('numbers.dnd')}
            hint={t('numbers.dndHint')}
            checked={dndOn}
            onChange={(v) => update.mutate({ dndUntil: v ? DND_FOREVER : null })}
          />
        </div>
        <button
          type="button"
          onClick={() => setHistoryOpen(true)}
          className="flex min-h-14 w-full items-center gap-3 py-2 text-left"
        >
          <Clock className="size-5 text-muted" aria-hidden />
          <span className="flex-1">
            <span className="block text-sm font-medium">{t('numbers.defaultHistory')}</span>
            <span className="block text-xs text-muted">{t('numbers.defaultHistoryHint')}</span>
          </span>
          <span className="text-sm text-muted">{t(`numbers.retention.${number.defaultRetention}`)}</span>
          <ChevronRight className="size-4 text-muted" aria-hidden />
        </button>
      </Card>
      {update.error && <p className="mt-2 text-sm text-danger">{update.error.message}</p>}

      <Dialog open={editingName} onOpenChange={setEditingName} title={t('numbers.editName')}>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ displayName: name }, { onSuccess: () => setEditingName(false) });
          }}
        >
          <TextField label={t('numbers.displayName')} value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
          <Button type="submit" variant="gradient" fullWidth disabled={!name.trim() || update.isPending}>
            {t('numbers.save')}
          </Button>
        </form>
      </Dialog>

      <Dialog open={historyOpen} onOpenChange={setHistoryOpen} title={t('numbers.defaultHistory')} description={t('numbers.defaultHistoryHint')}>
        <div role="radiogroup" aria-label={t('numbers.defaultHistory')} className="flex flex-col">
          {RETENTION_OPTIONS.map((option: Retention) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={number.defaultRetention === option}
              onClick={() => update.mutate({ defaultRetention: option }, { onSuccess: () => setHistoryOpen(false) })}
              className="flex h-12 items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-surface-2"
            >
              <span
                className={cn(
                  'inline-flex size-5 items-center justify-center rounded-full border-2',
                  number.defaultRetention === option ? 'border-primary' : 'border-border',
                )}
              >
                {number.defaultRetention === option && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              {t(`numbers.retention.${option}`)}
            </button>
          ))}
        </div>
      </Dialog>

      <DeleteNumberDialog number={number} open={confirmDelete} onOpenChange={setConfirmDelete} />
    </div>
  );
}
