import type { ConversationDto } from '@hellogram/shared';
import { Avatar } from '@hellogram/ui';
import { ArrowLeft, EllipsisVertical, Phone } from 'lucide-react';
import { useNavigate } from 'react-router';
import { t } from '../../../i18n/t.js';

import { useTypingStore } from '../model/typing.js';
import { chatTitle } from './ConversationRow.js';
import { NumberLabel } from '../../numbers/components/NumberLabel.js';

export function ChatHeader({
  conversation: c,
  onToggleDetails,
  onCall,
}: {
  conversation: ConversationDto;
  onToggleDetails: () => void;
  onCall?: (() => void) | undefined;
}) {
  const navigate = useNavigate();
  const typing = useTypingStore((s) => s.typing[c.id] ?? false);

  return (
    <header className="flex items-center gap-2 border-b border-border bg-surface-1 px-2 py-2 lg:px-4">
      <button
        type="button"
        onClick={() => navigate('/inbox')}
        aria-label={t('chat.back')}
        className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2 lg:hidden"
      >
        <ArrowLeft className="size-5" aria-hidden />
      </button>
      <button type="button" onClick={onToggleDetails} className="flex min-w-0 flex-1 items-center gap-3 text-left">
        <Avatar name={chatTitle(c)} src={c.counterpart.avatarUrl} size={40} />
        <span className="min-w-0">
          <span className="block truncate font-semibold">{chatTitle(c)}</span>
          <span className="flex items-center gap-1.5 text-xs text-muted" aria-live="polite">
            {typing ? (
              <span className="font-medium text-primary">{t('chat.typing')}</span>
            ) : (
              <>
                <NumberLabel of={c.me} prefix={t('chat.via')} />
                {c.counterpart.code && <span className="font-mono">· {c.counterpart.code}</span>}
              </>
            )}
          </span>
        </span>
      </button>
      {onCall && !c.unavailable && !c.counterpart.masked && (
        <button
          type="button"
          onClick={onCall}
          aria-label={t('chat.call')}
          className="inline-flex size-11 items-center justify-center rounded-full text-success hover:bg-surface-2"
        >
          <Phone className="size-5" aria-hidden />
        </button>
      )}
      <button
        type="button"
        onClick={onToggleDetails}
        aria-label={t('chat.details')}
        className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2"
      >
        <EllipsisVertical className="size-5" aria-hidden />
      </button>
    </header>
  );
}
