import { CALLER_TUNES, RINGTONES, type CallerTune, type Ringtone } from '@hellogram/shared';
import { Dialog, cn } from '@hellogram/ui';
import { ChevronRight, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { previewCallerTune, previewRingtone } from '../../core/sound/tones.js';
import { t } from '../../i18n/t.js';

export const ringtoneName = (tone: Ringtone) => t(`profile.ringtones.${tone}`);
export const callerTuneName = (tune: CallerTune) => t(`tones.callerTunes.${tune}`);

type Kind = 'ringtone' | 'callerTune';

/**
 * A settings row showing the chosen tone, opening a list to pick one (each with a play button).
 * `null` is the first choice: "Default", whose meaning `defaultLabel` explains.
 */
export function TonePickerRow<K extends Kind>({
  kind,
  icon,
  title,
  hint,
  defaultLabel,
  value,
  onPick,
  disabled,
}: {
  kind: K;
  icon: ReactNode;
  title: string;
  hint: string;
  defaultLabel: string;
  value: (K extends 'ringtone' ? Ringtone : CallerTune) | null;
  onPick: (value: (K extends 'ringtone' ? Ringtone : CallerTune) | null) => void;
  disabled?: boolean;
}) {
  type Tone = K extends 'ringtone' ? Ringtone : CallerTune;
  const [open, setOpen] = useState(false);
  const [previewing, setPreviewing] = useState<Tone | null>(null);
  const stop = useRef<(() => void) | null>(null);
  const tones = (kind === 'ringtone' ? RINGTONES : CALLER_TUNES) as readonly unknown[] as readonly Tone[];
  const name = (tone: Tone) => (kind === 'ringtone' ? ringtoneName(tone as Ringtone) : callerTuneName(tone as CallerTune));

  const stopPreview = () => {
    stop.current?.();
    stop.current = null;
    setPreviewing(null);
  };
  useEffect(() => stopPreview, []);

  const preview = (tone: Tone) => {
    const again = previewing === tone;
    stopPreview();
    if (again) return;
    const end = kind === 'ringtone' ? previewRingtone(tone as Ringtone) : previewCallerTune(tone as CallerTune);
    stop.current = end;
    setPreviewing(tone);
    setTimeout(() => stop.current === end && stopPreview(), 4000);
  };

  const pick = (tone: Tone | null) => {
    stopPreview();
    onPick(tone);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 py-2 text-left disabled:opacity-60"
      >
        <span className="text-muted">{icon}</span>
        <span className="flex-1">
          <span className="block text-sm font-medium">{title}</span>
          <span className="block text-xs text-muted">{hint}</span>
        </span>
        <span className="text-sm text-muted">{value ? name(value) : t('tones.default')}</span>
        <ChevronRight className="size-4 text-muted" aria-hidden />
      </button>

      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) stopPreview();
          setOpen(v);
        }}
        title={title}
        description={hint}
      >
        <div role="radiogroup" aria-label={title} className="flex flex-col">
          {[null, ...tones].map((tone) => (
            <div key={tone ?? 'default'} className="flex min-h-12 items-center gap-2">
              <button
                type="button"
                role="radio"
                aria-checked={value === tone}
                onClick={() => pick(tone)}
                className="flex min-h-12 flex-1 items-center gap-3 rounded-md px-2 text-left text-sm hover:bg-surface-2"
              >
                <span
                  className={cn(
                    'inline-flex size-5 shrink-0 items-center justify-center rounded-full border-2',
                    value === tone ? 'border-primary' : 'border-border',
                  )}
                >
                  {value === tone && <span className="size-2.5 rounded-full bg-primary" />}
                </span>
                <span>
                  <span className="block">{tone ? name(tone) : t('tones.default')}</span>
                  {!tone && <span className="block text-xs text-muted">{defaultLabel}</span>}
                </span>
              </button>
              {tone && tone !== 'silent' && (
                <button
                  type="button"
                  onClick={() => preview(tone)}
                  aria-label={t(previewing === tone ? 'profile.stopPreview' : 'profile.preview', { name: name(tone) })}
                  className={cn(
                    'inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2',
                    previewing === tone && 'text-primary',
                  )}
                >
                  {previewing === tone ? <Pause className="size-4" aria-hidden /> : <Play className="size-4" aria-hidden />}
                </button>
              )}
            </div>
          ))}
        </div>
      </Dialog>
    </>
  );
}
