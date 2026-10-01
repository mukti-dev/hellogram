import { LIMITS } from '@hellogram/shared';
import { cn } from '@hellogram/ui';
import { Paperclip, SendHorizontal, Smile } from 'lucide-react';
import { useRef, useState, type KeyboardEvent } from 'react';
import { getSocket } from '../../../core/realtime/socket.js';
import { t } from '../../../i18n/t.js';
import { useSendMessage } from '../model/send.js';

const FEATURE_MEDIA = import.meta.env.VITE_FEATURE_MEDIA === 'true';

export function Composer({ conversationId }: { conversationId: string }) {
  const [text, setText] = useState('');
  const send = useSendMessage(conversationId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const lastTyping = useRef(0);

  const submit = () => {
    const body = text.trim();
    if (!body) return;
    send.mutate(body);
    setText('');
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto';
      ref.current?.focus();
    });
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const onChange = (value: string) => {
    setText(value.slice(0, LIMITS.MESSAGE_MAX));
    const el = ref.current;
    if (el) {
      el.style.height = 'auto';
      el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
    }
    // Rule 18: the server throttles too; this just avoids needless traffic.
    if (Date.now() - lastTyping.current > 3000) {
      lastTyping.current = Date.now();
      getSocket()?.emit('typing', { conversationId });
    }
  };

  return (
    <form
      className="flex items-end gap-2 border-t border-border bg-surface-1 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {FEATURE_MEDIA && (
        <button type="button" aria-label={t('chat.attach')} className="inline-flex size-11 items-center justify-center rounded-full text-muted hover:bg-surface-2">
          <Paperclip className="size-5" aria-hidden />
        </button>
      )}
      <div className="flex min-h-11 flex-1 items-end rounded-3xl border border-border bg-surface-2 pr-2 focus-within:border-primary">
        <label htmlFor={`composer-${conversationId}`} className="sr-only">
          {t('chat.typeMessage')}
        </label>
        <textarea
          id={`composer-${conversationId}`}
          ref={ref}
          rows={1}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={t('chat.typeMessage')}
          className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-4 py-2.5 text-[15px] outline-none placeholder:text-muted"
        />
        <Smile className="mb-3 size-5 text-muted" aria-hidden />
      </div>
      <button
        type="submit"
        aria-label={t('chat.send')}
        disabled={!text.trim()}
        className={cn(
          'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition',
          text.trim() ? 'bg-gradient-primary' : 'bg-surface-3 text-muted',
        )}
      >
        <SendHorizontal className="size-5" aria-hidden />
      </button>
    </form>
  );
}
