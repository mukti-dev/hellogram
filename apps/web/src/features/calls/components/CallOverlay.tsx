import { Avatar, cn } from '@hellogram/ui';
import { NumberLabel } from '../../numbers/components/NumberLabel.js';
import { Mic, MicOff, Phone, PhoneOff, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNow } from '../../../shared/use-now.js';
import { t } from '../../../i18n/t.js';

import { useCallStore } from '../model/call-store.js';
import { AudioPanel } from './AudioPanel.js';

function useTimer(startedAt: number | null) {
  const now = useNow(1000);
  if (!startedAt) return '00:00';
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

function RoundButton({ label, onClick, tone, children }: { label: string; onClick: () => void; tone: 'red' | 'green' | 'glass'; children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          'inline-flex size-18 items-center justify-center rounded-full text-white shadow-xl transition active:scale-95',
          tone === 'red' && 'bg-[#EF4444] hover:brightness-110',
          tone === 'green' && 'bg-[#22C55E] hover:brightness-110',
          tone === 'glass' && 'bg-white/15 hover:bg-white/25',
        )}
      >
        {children}
      </button>
      <span className="text-sm text-white/80">{label}</span>
    </div>
  );
}

/** Screens 12: incoming, outgoing/ringing and in-call — full-screen overlay. */
export function CallOverlay() {
  const s = useCallStore();
  const timer = useTimer(s.startedAt);
  const inCall = s.phase === 'outgoing' || s.phase === 'connecting' || s.phase === 'active';
  // Opened for one call: it closes by itself when that call ends (and with Escape).
  const [audioFor, setAudioFor] = useState<string | null>(null);
  const audioOpen = inCall && audioFor !== null && audioFor === s.callId;
  const setAudioOpen = (open: boolean) => setAudioFor(open ? s.callId : null);

  useEffect(() => {
    if (!audioOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setAudioFor(null);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [audioOpen]);

  if (s.phase === 'idle' || !s.party) return null;

  const status =
    s.phase === 'incoming'
      ? t('calls.incoming')
      : s.phase === 'outgoing'
        ? t('calls.calling')
        : s.phase === 'connecting'
          ? t('calls.connecting')
          : s.phase === 'active'
            ? timer
            : s.endedLabel;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={status ?? ''}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-between bg-[radial-gradient(120%_90%_at_50%_0%,#3B2A8C_0%,#1A1440_45%,#0B0B14_100%)] px-6 py-12 text-white"
    >
      <div className="flex flex-col items-center text-center">
        <p className="text-base text-white/80" aria-live="polite">{status}</p>
        <div className="mt-8 rounded-full p-1.5 ring-4 ring-white/10">
          <Avatar name={s.party.name} src={s.party.avatarUrl} size={120} />
        </div>
        <h1 className="mt-6 text-3xl font-bold">{s.party.name}</h1>
        {s.party.labelIcon && s.party.labelName && (
          <NumberLabel
            of={{ labelIcon: s.party.labelIcon, labelName: s.party.labelName }}
            prefix={t('chat.via')}
            className="mt-3 bg-white/15 text-white"
          />
        )}
        {s.party.code && (
          <p className="mt-2 font-mono text-sm text-white/75">
            {s.direction === 'incoming' ? t('calls.to', { code: s.party.code }) : s.party.code}
          </p>
        )}
      </div>

      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        {s.phase === 'incoming' && (
          <div className="flex w-full justify-around">
            <RoundButton label={t('calls.decline')} tone="red" onClick={() => void s.decline()}>
              <PhoneOff className="size-8" aria-hidden />
            </RoundButton>
            <RoundButton label={t('calls.accept')} tone="green" onClick={() => void s.accept()}>
              <Phone className="size-8" aria-hidden />
            </RoundButton>
          </div>
        )}
        {inCall && (
          <div className="flex w-full justify-around">
            <RoundButton label={s.muted ? t('calls.unmute') : t('calls.mute')} tone="glass" onClick={s.toggleMute}>
              {s.muted ? <MicOff className="size-7" aria-hidden /> : <Mic className="size-7" aria-hidden />}
            </RoundButton>
            <RoundButton label={t('calls.audio')} tone="glass" onClick={() => setAudioOpen(true)}>
              <SlidersHorizontal className="size-7" aria-hidden />
            </RoundButton>
            <RoundButton label={t('calls.end')} tone="red" onClick={() => void s.hangUp()}>
              <PhoneOff className="size-8" aria-hidden />
            </RoundButton>
          </div>
        )}
        <p className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-sm text-white/80">
          <ShieldCheck className="size-4" aria-hidden />
          {t('calls.hidden')}
        </p>
      </div>
      {audioOpen && <AudioPanel onClose={() => setAudioOpen(false)} />}
    </div>
  );
}
