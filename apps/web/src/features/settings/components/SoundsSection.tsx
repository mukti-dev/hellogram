import { Card, Switch, cn } from '@hellogram/ui';
import { BellRing, MessageSquare, Pause, Play } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { MESSAGE_TONES, RINGTONES, useSoundPrefs, type MessageTone, type Ringtone } from '../../../core/sound/sound-prefs.js';
import { playMessageTone, previewRingtone } from '../../../core/sound/tones.js';
import { t } from '../../../i18n/t.js';

const canVibrate = typeof navigator !== 'undefined' && 'vibrate' in navigator;

/** Ringtone, message sound and vibration — saved on this device only. */
export function SoundsSection() {
  const { ringtone, messageTone, vibrate, setRingtone, setMessageTone, setVibrate } = useSoundPrefs();
  const [previewing, setPreviewing] = useState<Ringtone | null>(null);
  const stopPreview = useRef<(() => void) | null>(null);
  const previewTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const stop = () => {
    stopPreview.current?.();
    stopPreview.current = null;
    clearTimeout(previewTimer.current);
    setPreviewing(null);
  };

  const preview = (tone: Ringtone) => {
    const wasPlaying = previewing === tone;
    stop();
    if (wasPlaying || tone === 'silent') return;
    stopPreview.current = previewRingtone(tone);
    setPreviewing(tone);
    previewTimer.current = setTimeout(() => setPreviewing(null), 3000);
  };

  // Stop any preview when leaving the page.
  useEffect(
    () => () => {
      stopPreview.current?.();
      clearTimeout(previewTimer.current);
    },
    [],
  );

  const pickRingtone = (tone: Ringtone) => {
    setRingtone(tone);
    preview(tone);
  };

  const pickMessageTone = (tone: MessageTone) => {
    setMessageTone(tone);
    playMessageTone(tone, false);
  };

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{t('profile.sounds')}</h2>
      <p className="text-xs text-muted">{t('profile.soundsHint')}</p>

      <fieldset className="mt-4">
        <legend className="flex items-center gap-2 text-sm font-medium">
          <BellRing className="size-4 text-muted" aria-hidden />
          {t('profile.ringtone')}
        </legend>
        <div className="mt-2 divide-y divide-border rounded-md border border-border">
          {RINGTONES.map((tone) => (
            <div key={tone} className="flex min-h-12 items-center gap-3 px-3">
              <label className="flex flex-1 cursor-pointer items-center gap-3 text-sm">
                <input
                  type="radio"
                  name="ringtone"
                  value={tone}
                  checked={ringtone === tone}
                  onChange={() => pickRingtone(tone)}
                  className="size-4 accent-primary"
                />
                {t(`profile.ringtones.${tone}`)}
              </label>
              {tone !== 'silent' && (
                <button
                  type="button"
                  onClick={() => preview(tone)}
                  aria-label={t(previewing === tone ? 'profile.stopPreview' : 'profile.preview', { name: t(`profile.ringtones.${tone}`) })}
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
      </fieldset>

      <fieldset className="mt-5">
        <legend className="flex items-center gap-2 text-sm font-medium">
          <MessageSquare className="size-4 text-muted" aria-hidden />
          {t('profile.messageTone')}
        </legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {MESSAGE_TONES.map((tone) => (
            <label
              key={tone}
              className={cn(
                'flex h-10 cursor-pointer items-center gap-2 rounded-full border px-4 text-sm has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary/40',
                messageTone === tone ? 'border-primary bg-primary/10 font-medium' : 'border-border hover:bg-surface-2',
              )}
            >
              <input
                type="radio"
                name="message-tone"
                value={tone}
                checked={messageTone === tone}
                onChange={() => pickMessageTone(tone)}
                className="sr-only"
              />
              {t(`profile.messageTones.${tone}`)}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <div className="flex-1">
          <p className="text-sm font-medium">{t('profile.vibrate')}</p>
          <p className="text-xs text-muted">{canVibrate ? t('profile.vibrateHint') : t('profile.vibrateUnsupported')}</p>
        </div>
        <Switch checked={vibrate} onCheckedChange={setVibrate} label={t('profile.vibrate')} disabled={!canVibrate} />
      </div>
    </Card>
  );
}
