import type { AttachmentDto, GifDto } from '@hellogram/shared';
import { Button, Dialog, cn } from '@hellogram/ui';
import { Download, FileText, ImageOff, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
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

const STICKER_SIZE = 140;

/** A sticker: just the picture, no bubble around it. */
function StickerAttachment({ attachment }: { attachment: AttachmentDto }) {
  const { url } = useAttachmentUrl(attachment.id);
  return (
    <span className="block" style={{ width: STICKER_SIZE, height: STICKER_SIZE }}>
      {url && <img src={url} alt={t('chat.sticker')} className="size-full object-contain" draggable={false} />}
    </span>
  );
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** A voice message: play/pause, the waveform recorded on the phone (filling as it plays) and the time. */
function VoiceAttachment({ attachment, mine }: { attachment: AttachmentDto; mine: boolean }) {
  const { url, failed } = useAttachmentUrl(attachment.id, attachment.mimeType);
  const audio = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const duration = attachment.durationMs ?? 0;
  const bars = attachment.waveform?.length ? attachment.waveform : new Array<number>(32).fill(8);
  const progress = duration ? Math.min(position / duration, 1) : 0;

  useEffect(() => () => audio.current?.pause(), []);

  const toggle = () => {
    const el = audio.current;
    if (!el) return;
    if (el.paused) void el.play();
    else el.pause();
  };

  if (failed) {
    return <p className="px-2 py-1.5 text-sm italic opacity-80">{t('chat.fileUnavailable')}</p>;
  }
  return (
    <div className="flex w-64 max-w-full items-center gap-2.5 px-1 py-1">
      <button
        type="button"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? t('chat.pauseVoice') : t('chat.playVoice')}
        className={cn(
          'inline-flex size-10 shrink-0 items-center justify-center rounded-full disabled:opacity-60',
          mine ? 'bg-white text-primary' : 'bg-primary text-white',
        )}
      >
        {playing ? <Pause className="size-4" aria-hidden /> : <Play className="size-4 translate-x-px" aria-hidden />}
      </button>
      <span className="flex h-8 min-w-0 flex-1 items-center gap-[2px]" aria-hidden>
        {bars.map((level, i) => (
          <span
            key={i}
            className={cn(
              'w-[3px] shrink-0 rounded-full',
              i / bars.length < progress ? (mine ? 'bg-white' : 'bg-primary') : mine ? 'bg-white/45' : 'bg-fg/25',
            )}
            style={{ height: `${Math.max(12, (level / 31) * 100)}%` }}
          />
        ))}
      </span>
      <span className={cn('w-9 shrink-0 text-right text-xs tabular-nums', mine ? 'text-white/80' : 'text-muted')}>
        {mmss(playing || position ? position : duration)}
      </span>
      {url && (
        <audio
          ref={audio}
          src={url}
          preload="metadata"
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onTimeUpdate={(e) => setPosition(e.currentTarget.currentTime * 1000)}
          onEnded={() => setPosition(0)}
        />
      )}
    </div>
  );
}

/** A photo, sticker, voice message or file in a message. The bytes are fetched with the access token, never by plain URL. */
export function AttachmentView({ attachment, mine }: { attachment: AttachmentDto; mine: boolean }) {
  if (attachment.kind === 'image') return <ImageAttachment attachment={attachment} />;
  if (attachment.kind === 'sticker') return <StickerAttachment attachment={attachment} />;
  if (attachment.kind === 'voice') return <VoiceAttachment attachment={attachment} mine={mine} />;
  return <FileAttachment attachment={attachment} mine={mine} />;
}

/** A GIF from KLIPY: loaded straight from KLIPY's media host, as their terms require. */
export function GifView({ gif }: { gif: GifDto }) {
  const ratio = gif.width / gif.height;
  const width = Math.round(Math.min(MAX_WIDTH, MAX_HEIGHT * ratio, gif.width));
  return (
    <img
      src={gif.url}
      alt={t('chat.gif')}
      referrerPolicy="no-referrer"
      loading="lazy"
      className="block rounded-xl bg-black/10 object-cover"
      style={{ width, aspectRatio: String(ratio) }}
      draggable={false}
    />
  );
}
