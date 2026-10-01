import type { OwnPersonaDto } from '@hellogram/shared';
import { Avatar, Card, DropdownMenu, NumberCode, StatusChip, cn } from '@hellogram/ui';
import { EllipsisVertical, Eye, Lock, Pause, Phone, PhoneOff, Play, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';
import { usePauseResume } from '../model/queries.js';
import { DeleteNumberDialog } from './DeleteNumberDialog.js';
import { NumberLabel } from '../components/NumberLabel.js';

export function NumberCard({ number }: { number: OwnPersonaDto }) {
  const navigate = useNavigate();
  const pauseResume = usePauseResume(number.id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const CallIcon = number.allowCalls ? Phone : PhoneOff;
  const status = number.locked ? 'locked' : number.status;

  return (
    <Card className="relative flex items-center gap-4 p-4 transition hover:border-primary/50">
      <Avatar name={number.displayName} src={number.avatarUrl} size={56} />
      <div className="min-w-0 flex-1">
        <NumberLabel of={number} />
        {/* Whole card is clickable via this link's stretched hit area. */}
        <Link to={`/numbers/${number.id}`} className="mt-1.5 block truncate font-semibold after:absolute after:inset-0">
          {number.displayName}
        </Link>
        <NumberCode code={number.code} className="text-sm text-muted" />
      </div>
      <div className="relative z-10 flex flex-col items-end gap-3">
        <div className="flex items-center gap-1">
          <span
            role="img"
            aria-label={number.allowCalls ? t('numbers.allowCalls') : t('numbers.callsOff')}
            className={cn(
              'inline-flex size-9 items-center justify-center rounded-full',
              number.allowCalls ? 'bg-success/15 text-success' : 'bg-surface-3 text-muted',
            )}
          >
            <CallIcon className="size-4" aria-hidden />
          </span>
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label={t('numbers.moreActions', { name: number.displayName })}
                className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
              >
                <EllipsisVertical className="size-4" aria-hidden />
              </button>
            }
            items={[
              { label: t('numbers.viewShare'), icon: <Eye className="size-4" />, onSelect: () => navigate(`/numbers/${number.id}`) },
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
        <StatusChip status={status}>
          {status === 'locked' && <Lock className="size-3" aria-hidden />}
          {t(`numbers.status.${status}`)}
        </StatusChip>
      </div>
      <DeleteNumberDialog number={number} open={confirmDelete} onOpenChange={setConfirmDelete} />
    </Card>
  );
}
