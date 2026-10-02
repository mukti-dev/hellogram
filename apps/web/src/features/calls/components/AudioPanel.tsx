import { Switch } from '@hellogram/ui';
import { AudioLines, Mic, Volume2, X } from 'lucide-react';
import { useState } from 'react';
import { t } from '../../../i18n/t.js';
import { outputSelectionSupported, useAudioDevices, useAudioPrefs, type AudioDevice } from '../model/audio-devices.js';
import { useCallStore } from '../model/call-store.js';

function DeviceList({
  name,
  devices,
  selected,
  onSelect,
}: {
  name: string;
  devices: AudioDevice[];
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  // A remembered device that is no longer connected counts as the default.
  const current = selected && devices.some((d) => d.id === selected) ? selected : null;
  const options = [{ id: null, label: t('calls.systemDefault') }, ...devices];
  return (
    <div className="mt-2 divide-y divide-white/10 rounded-md border border-white/10">
      {options.map((d) => (
        <label key={d.id ?? 'default'} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 text-sm">
          <input
            type="radio"
            name={name}
            checked={current === d.id}
            onChange={() => onSelect(d.id)}
            className="size-4 shrink-0 accent-primary"
          />
          <span className="truncate">{d.label}</span>
        </label>
      ))}
    </div>
  );
}

/** In-call audio: microphone, speaker and noise cancellation. Choices are remembered on this device. */
export function AudioPanel({ onClose }: { onClose: () => void }) {
  const { inputs, outputs } = useAudioDevices();
  const { micId, speakerId, noiseCancellation } = useAudioPrefs();
  const { selectMicrophone, selectSpeaker, setNoiseCancellation, noiseCancellationActive } = useCallStore();
  const [error, setError] = useState<string | null>(null);
  const canPickSpeaker = outputSelectionSupported();

  const pickMic = (id: string | null) => {
    setError(null);
    selectMicrophone(id).catch(() => setError(t('calls.micSwitchFailed')));
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="call-audio-title"
      className="absolute inset-x-0 bottom-0 z-10 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-[#14112B]/95 px-5 pt-4 pb-8 text-white shadow-2xl backdrop-blur"
    >
      <div className="mx-auto max-w-sm">
        <div className="flex items-center justify-between">
          <h2 id="call-audio-title" className="text-lg font-semibold">
            {t('calls.audio')}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t('calls.closeAudio')}
            className="inline-flex size-10 items-center justify-center rounded-full hover:bg-white/10"
          >
            <X className="size-5" aria-hidden />
          </button>
        </div>

        <section className="mt-4">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <AudioLines className="size-4 text-white/70" aria-hidden />
            {t('calls.noiseCancellation')}
          </h3>
          <div className="mt-2 flex items-start gap-3 rounded-md border border-white/10 px-3 py-3">
            <p className="flex-1 text-sm text-white/75">
              {noiseCancellation && !noiseCancellationActive ? t('calls.noiseCancellationFallback') : t('calls.noiseCancellationHint')}
            </p>
            <Switch
              checked={noiseCancellation}
              onCheckedChange={(on) => void setNoiseCancellation(on)}
              label={t('calls.noiseCancellation')}
            />
          </div>
        </section>

        <section className="mt-5">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Mic className="size-4 text-white/70" aria-hidden />
            {t('calls.microphone')}
          </h3>
          <DeviceList name="call-mic" devices={inputs} selected={micId} onSelect={pickMic} />
          {error && (
            <p role="alert" className="mt-2 text-sm text-[#FCA5A5]">
              {error}
            </p>
          )}
        </section>

        <section className="mt-5">
          <h3 className="flex items-center gap-2 text-sm font-medium">
            <Volume2 className="size-4 text-white/70" aria-hidden />
            {t('calls.speaker')}
          </h3>
          {canPickSpeaker ? (
            <DeviceList name="call-speaker" devices={outputs} selected={speakerId} onSelect={(id) => void selectSpeaker(id)} />
          ) : (
            <p className="mt-2 rounded-md border border-white/10 px-3 py-3 text-sm text-white/75">{t('calls.speakerUnsupported')}</p>
          )}
        </section>
      </div>
    </div>
  );
}
