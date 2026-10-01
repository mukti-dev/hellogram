import type { AttachmentDto } from '@hellogram/shared';
import { Button, Dialog, cn } from '@hellogram/ui';
import { Download, FileText, ImageOff } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../../i18n/t.js';
import { fileSize, saveAttachment, useAttachmentUrl } from '../model/attachments.js';

const MAX_WIDTH = 280;
const MAX_HEIGHT = 340;

function ImageAttachment({ attachment }: { attachment: AttachmentDto }) {
  const { url, failed } = useAttachmentUrl(attachment.id);
  const [open, setOpen] = useState(false);
  // Reserve the final size up front so the chat doesn't jump when the photo arrives.
  const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : 1;
  const width = Math.round(Math.min(MAX_WIDTH, MAX_HEIGHT * ratio, attachment.width ?? MAX_WIDTH));

  if (failed) {
    return (
      <p className="flex items-center gap-2 px-2 py-1.5 text-sm italic opacity-80">
        <ImageOff className="size-4" aria-hidden />
        {t('chat.fileUnavailable')}
      </p>
    );
  }
  return (
    <>
      <button
        type="button"
        onClick={() => url && setOpen(true)}
        aria-label={t('chat.openPhoto')}
        className="block overflow-hidden rounded-xl bg-black/10"
        style={{ width, aspectRatio: String(ratio) }}
      >
        {url ? (
          <img src={url} alt={attachment.fileName} className="size-full object-cover" draggable={false} />
        ) : (
          <span className="block size-full animate-pulse bg-black/10" />
        )}
      </button>
      <Dialog open={open} onOpenChange={setOpen} title={attachment.fileName} className="sm:w-[min(94vw,900px)]">
        {url && <img src={url} alt={attachment.fileName} className="mx-auto mt-3 max-h-[70dvh] max-w-full rounded-md object-contain" />}
        <div className="mt-4 flex justify-end">
          <Button variant="outline" size="sm" leftIcon={<Download className="size-4" aria-hidden />} onClick={() => void saveAttachment(attachment)}>
            {t('chat.download')}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

function FileAttachment({ attachment, mine }: { attachment: AttachmentDto; mine: boolean }) {
  const [state, setState] = useState<'idle' | 'loading' | 'failed'>('idle');
  const save = () => {
    setState('loading');
    saveAttachment(attachment).then(
      () => setState('idle'),
      () => setState('failed'),
    );
  };
  return (
    <button
      type="button"
      onClick={save}
      disabled={state === 'loading'}
      aria-label={t('chat.downloadFile', { name: attachment.fileName })}
      className={cn(
        'flex w-64 max-w-full items-center gap-3 rounded-xl p-2.5 text-left',
        mine ? 'bg-white/15 hover:bg-white/20' : 'bg-surface-3 hover:bg-surface-1',
      )}
    >
      <span className={cn('inline-flex size-10 shrink-0 items-center justify-center rounded-lg', mine ? 'bg-white/20' : 'bg-primary-soft text-primary')}>
        <FileText className="size-5" aria-hidden />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{attachment.fileName}</span>
        <span className={cn('block text-xs', mine ? 'text-white/75' : 'text-muted')}>
          {state === 'failed' ? t('chat.fileUnavailable') : state === 'loading' ? t('common.loading') : fileSize(attachment.size)}
        </span>
      </span>
      <Download className={cn('size-4 shrink-0', mine ? 'text-white/80' : 'text-muted')} aria-hidden />
    </button>
  );
}

/** A photo or file inside a message bubble. The bytes are fetched with the access token, never by plain URL. */
export function AttachmentView({ attachment, mine }: { attachment: AttachmentDto; mine: boolean }) {
  return attachment.kind === 'image' ? <ImageAttachment attachment={attachment} /> : <FileAttachment attachment={attachment} mine={mine} />;
}
