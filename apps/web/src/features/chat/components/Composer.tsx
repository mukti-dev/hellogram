import { LIMITS } from '@hellogram/shared';
import { cn } from '@hellogram/ui';
import { FileText, LoaderCircle, Paperclip, SendHorizontal, Smile, X } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from 'react';
import { getSocket } from '../../../core/realtime/socket.js';
import { t } from '../../../i18n/t.js';
import { ATTACHMENT_ACCEPT, fileSize, tooLarge } from '../model/attachments.js';
import { useSendAttachment, useSendMessage } from '../model/send.js';

/** `mediaAllowed`: photos and files only when both numbers in the chat allow them. */
export function Composer({ conversationId, mediaAllowed = true }: { conversationId: string; mediaAllowed?: boolean }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const send = useSendMessage(conversationId);
  const sendFile = useSendAttachment(conversationId);
  const ref = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const lastTyping = useRef(0);

  const preview = useMemo(() => (file?.type.startsWith('image/') ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const resetInput = () => {
    setText('');
    requestAnimationFrame(() => {
      if (ref.current) ref.current.style.height = 'auto';
      ref.current?.focus();
    });
  };

  const choose = (next: File | null) => {
    sendFile.reset();
    // Photos are shrunk before upload, so only other files are checked here.
    if (next && !next.type.startsWith('image/') && tooLarge(next)) {
      setFileError(t('chat.fileTooLarge'));
      return;
    }
    setFileError(null);
    setFile(next);
    if (next) ref.current?.focus();
  };

  const submit = () => {
    if (sendFile.isPending) return;
    if (file) {
      sendFile.mutate(
        { file, caption: text },
        {
          onSuccess: () => {
            setFile(null);
            resetInput();
          },
        },
      );
      return;
    }
    const body = text.trim();
    if (!body) return;
    send.mutate(body);
    resetInput();
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  // Pasting a screenshot or a copied file attaches it.
  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = e.clipboardData.files[0];
    if (!pasted || !mediaAllowed) return;
    e.preventDefault();
    choose(pasted);
  };

  const onChange = (value: string) => {
    setText(value.slice(0, file ? LIMITS.ATTACHMENT_CAPTION_MAX : LIMITS.MESSAGE_MAX));
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

  const error = fileError ?? sendFile.error?.message ?? null;
  const canSend = Boolean(file) || Boolean(text.trim());

  return (
    <form
      className="border-t border-border bg-surface-1 p-3"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      {error && (
        <p role="alert" className="mb-2 px-1 text-sm text-danger">
          {error}
        </p>
      )}
      {file && (
        <div className="mb-2 flex items-center gap-3 rounded-xl border border-border bg-surface-2 p-2">
          {preview ? (
            <img src={preview} alt="" className="size-14 shrink-0 rounded-lg object-cover" />
          ) : (
            <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-lg bg-primary-soft text-primary">
              <FileText className="size-6" aria-hidden />
            </span>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{file.name}</p>
            <p className="text-xs text-muted">{sendFile.isPending ? t('chat.sendingFile') : fileSize(file.size)}</p>
          </div>
          <button
            type="button"
            onClick={() => choose(null)}
            disabled={sendFile.isPending}
            aria-label={t('chat.removeAttachment')}
            className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-3 disabled:opacity-50"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>
      )}
      <div className="flex items-end gap-2">
        <input
          ref={picker}
          type="file"
          accept={ATTACHMENT_ACCEPT}
          className="hidden"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            choose(e.target.files?.[0] ?? null);
            e.target.value = ''; // picking the same file again still fires
          }}
        />
        {mediaAllowed && (
          <button
            type="button"
            onClick={() => picker.current?.click()}
            disabled={sendFile.isPending}
            aria-label={t('chat.attach')}
            className="inline-flex size-11 shrink-0 items-center justify-center rounded-full text-muted hover:bg-surface-2 disabled:opacity-50"
          >
            <Paperclip className="size-5" aria-hidden />
          </button>
        )}
        <div className="flex min-h-11 flex-1 items-end rounded-3xl border border-border bg-surface-2 pr-2 focus-within:border-primary">
          <label htmlFor={`composer-${conversationId}`} className="sr-only">
            {file ? t('chat.addCaption') : t('chat.typeMessage')}
          </label>
          <textarea
            id={`composer-${conversationId}`}
            ref={ref}
            rows={1}
            value={text}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
            placeholder={file ? t('chat.addCaption') : t('chat.typeMessage')}
            className="max-h-40 min-h-11 flex-1 resize-none bg-transparent px-4 py-2.5 text-[15px] outline-none placeholder:text-muted"
          />
          <Smile className="mb-3 size-5 text-muted" aria-hidden />
        </div>
        <button
          type="submit"
          aria-label={t('chat.send')}
          disabled={!canSend || sendFile.isPending}
          className={cn(
            'inline-flex size-11 shrink-0 items-center justify-center rounded-full text-white transition',
            canSend ? 'bg-gradient-primary' : 'bg-surface-3 text-muted',
          )}
        >
          {sendFile.isPending ? <LoaderCircle className="size-5 animate-spin" aria-hidden /> : <SendHorizontal className="size-5" aria-hidden />}
        </button>
      </div>
    </form>
  );
}
