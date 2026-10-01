import { RETENTION_OPTIONS, type ConversationDto, type Retention } from '@hellogram/shared';
import { Avatar, Button, Dialog, Switch, TextField, cn } from '@hellogram/ui';
import { Bell, Pencil, Phone, Trash2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { t } from '../../../i18n/t.js';

import { SafetyRows } from '../../safety/components/SafetyRows.js';
import { useClearChat, useUpdateConversation } from '../model/queries.js';
import { chatTitle } from './ConversationRow.js';
import { NumberLabel } from '../../numbers/components/NumberLabel.js';

const MUTE_FOREVER = '2099-12-31T00:00:00.000Z';

function Row({ icon, title, hint, danger, onClick, right }: {
  icon: ReactNode;
  title: string;
  hint?: string;
  danger?: boolean;
  onClick?: () => void;
  right?: ReactNode;
}) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      {...(onClick ? { type: 'button' as const, onClick } : {})}
      className={cn('flex min-h-14 w-full items-center gap-3 px-1 py-2 text-left', onClick && 'rounded-md hover:bg-surface-2')}
    >
      <span className={danger ? 'text-danger' : 'text-muted'}>{icon}</span>
      <span className="flex-1">
        <span className={cn('block text-sm font-medium', danger && 'text-danger')}>{title}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      {right}
    </Tag>
  );
}

/** Screen 10 / desktop right panel: chat settings. */
export function ChatDetailsPanel({
  conversation: c,
  onClose,
  onCall,
}: {
  conversation: ConversationDto;
  onClose: () => void;
  onCall?: (() => void) | undefined;
}) {
  const update = useUpdateConversation(c.id);
  const clear = useClearChat(c.id);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(c.nickname ?? '');
  const [confirmClear, setConfirmClear] = useState(false);
  const muted = Boolean(c.mutedUntil && new Date(c.mutedUntil) > new Date());
  const otherName = c.counterpart.displayName;

  return (
    <aside className="flex h-full flex-col overflow-y-auto bg-surface-1" aria-label={t('chat.settingsTitle')}>
      <div className="flex justify-end p-2">
        <button type="button" onClick={onClose} aria-label={t('common.cancel')} className="inline-flex size-10 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <X className="size-5" aria-hidden />
        </button>
      </div>
      <div className="flex flex-col items-center px-4 text-center">
        <Avatar name={chatTitle(c)} src={c.counterpart.avatarUrl} size={80} />
        <div className="mt-3 flex items-center gap-1">
          <h2 className="text-lg font-bold">{chatTitle(c)}</h2>
          <button
            type="button"
            aria-label={t('chat.rename')}
            onClick={() => {
              setName(c.nickname ?? '');
              setRenaming(true);
            }}
            className="inline-flex size-8 items-center justify-center rounded-full text-primary hover:bg-surface-2"
          >
            <Pencil className="size-4" aria-hidden />
          </button>
        </div>
        {c.nickname && !c.counterpart.masked && (
          <p className="text-xs text-muted">
            {t('chat.originalName', { name: otherName })}
            {c.counterpart.code && <span className="font-mono"> · {c.counterpart.code}</span>}
          </p>
        )}
        <NumberLabel of={c.me} prefix={t('chat.via')} className="mt-2" />

        {onCall && !c.unavailable && !c.counterpart.masked && (
          <div className="mt-4 grid w-full grid-cols-1 gap-2">
            <Button variant="secondary" onClick={onCall} leftIcon={<Phone className="size-4" aria-hidden />}>
              {t('chat.call')}
            </Button>
          </div>
        )}
      </div>

      <div className="mt-6 px-4">
        <h3 className="text-sm font-semibold">{t('chat.history')}</h3>
        <p className="text-xs text-muted">{t('chat.historyHint')}</p>
        <div role="radiogroup" aria-label={t('chat.history')} className="mt-2 flex flex-col">
          {RETENTION_OPTIONS.map((option: Retention) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={c.retention === option}
              disabled={c.unavailable || update.isPending}
              onClick={() => update.mutate({ retention: option })}
              className="flex h-10 items-center gap-3 rounded-md px-1 text-left text-sm hover:bg-surface-2 disabled:opacity-60"
            >
              <span className={cn('inline-flex size-5 items-center justify-center rounded-full border-2', c.retention === option ? 'border-primary' : 'border-border')}>
                {c.retention === option && <span className="size-2.5 rounded-full bg-primary" />}
              </span>
              {t(`numbers.retention.${option}`)}
            </button>
          ))}
        </div>
        <p className="mt-2 rounded-md bg-primary-soft px-3 py-2 text-xs">{t('chat.appliesBoth', { name: otherName })}</p>
      </div>

      <div className="mt-4 divide-y divide-border border-t border-border px-4">
        <Row
          icon={<Bell className="size-5" aria-hidden />}
          title={t('chat.mute')}
          right={
            <Switch checked={muted} onCheckedChange={(v) => update.mutate({ mutedUntil: v ? MUTE_FOREVER : null })} label={t('chat.mute')} />
          }
        />
        <Row icon={<Trash2 className="size-5" aria-hidden />} title={t('chat.clear')} hint={t('chat.clearHint')} danger onClick={() => setConfirmClear(true)} />
        <SafetyRows conversation={c} onDone={onClose} />
      </div>

      <Dialog open={renaming} onOpenChange={setRenaming} title={t('chat.rename')} description={t('chat.renameHint')}>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ nickname: name.trim() || null }, { onSuccess: () => setRenaming(false) });
          }}
        >
          <TextField label={t('chat.rename')} hideLabel value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder={otherName} autoFocus />
          <Button type="submit" variant="gradient" fullWidth disabled={update.isPending}>
            {t('numbers.save')}
          </Button>
          {c.nickname && (
            <Button variant="ghost" fullWidth onClick={() => update.mutate({ nickname: null }, { onSuccess: () => setRenaming(false) })}>
              {t('chat.removeName')}
            </Button>
          )}
        </form>
      </Dialog>

      <Dialog open={confirmClear} onOpenChange={setConfirmClear} title={t('chat.clear')} description={t('chat.clearConfirm')}>
        <Button variant="danger" fullWidth disabled={clear.isPending} onClick={() => clear.mutate(undefined, { onSuccess: () => setConfirmClear(false) })}>
          {t('chat.clear')}
        </Button>
      </Dialog>
    </aside>
  );
}
