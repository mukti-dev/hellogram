import type { ConversationDto } from '@hellogram/shared';
import { Avatar, CountBadge, LabelChip, cn } from '@hellogram/ui';
import { BellOff } from 'lucide-react';
import { NavLink } from 'react-router';
import { t } from '../../../i18n/t.js';
import { labelName, listTime } from '../../../shared/format.js';
import { systemText } from './MessageBubble.js';

export const chatTitle = (c: Pick<ConversationDto, 'nickname' | 'counterpart'>) => c.nickname ?? c.counterpart.displayName;

function preview(c: ConversationDto): string {
  const m = c.lastMessage;
  if (!m) return '';
  if (m.type === 'system') return systemText(m, c.counterpart.displayName);
  if (m.deleted) return m.mine ? t('chat.deletedMine') : t('chat.deleted');
  return `${m.mine ? 'You: ' : ''}${m.body ?? ''}`;
}

export function ConversationRow({ conversation: c }: { conversation: ConversationDto }) {
  const muted = c.mutedUntil && new Date(c.mutedUntil) > new Date();
  return (
    <NavLink
      to={`/inbox/${c.id}`}
      className={({ isActive }) =>
        cn('flex items-center gap-3 rounded-lg px-3 py-2.5 transition', isActive ? 'bg-surface-3' : 'hover:bg-surface-2')
      }
    >
      <Avatar name={chatTitle(c)} src={c.counterpart.avatarUrl} size={48} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className={cn('truncate text-sm', c.unread > 0 ? 'font-bold' : 'font-semibold')}>{chatTitle(c)}</p>
          <LabelChip kind={c.me.labelKind} text={labelName(c.me)} prefix={t('chat.via')} className="shrink-0" />
          <span className={cn('ml-auto shrink-0 text-[11px]', c.unread > 0 ? 'text-primary' : 'text-muted')}>
            {listTime(c.lastActivityAt)}
          </span>
        </div>
        <div className="mt-0.5 flex items-center gap-2">
          <p className={cn('truncate text-sm', c.unread > 0 ? 'text-fg' : 'text-muted')}>
            {c.unavailable ? t('chat.numberGone') : preview(c)}
          </p>
          {muted && <BellOff className="ml-auto size-3.5 shrink-0 text-muted" aria-label={t('chat.mute')} />}
          <CountBadge count={c.unread} className={muted ? 'bg-surface-3 text-muted' : 'ml-auto'} label={`${c.unread} unread`} />
        </div>
      </div>
    </NavLink>
  );
}
