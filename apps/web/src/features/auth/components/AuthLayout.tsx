import { Logo } from '@hellogram/ui';
import { LockKeyhole, MessageSquareText, Phone, ShieldCheck, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { t } from '../../../i18n/t.js';
import { AdultsOnlyFooter } from './AdultsOnlyFooter.js';

const features = [
  { icon: LockKeyhole, title: t('auth.features.privateTitle'), body: t('auth.features.privateBody'), tone: 'text-primary bg-primary-soft' },
  { icon: ShieldCheck, title: t('auth.features.secureTitle'), body: t('auth.features.secureBody'), tone: 'text-label-dating bg-label-dating/15' },
  { icon: Trash2, title: t('auth.features.blockTitle'), body: t('auth.features.blockBody'), tone: 'text-label-olx bg-label-olx/15' },
];

/** Decorative glass tiles (lock / chat / call) echoing the design illustration. */
function HeroArt({ compact = false }: { compact?: boolean }) {
  const tile = 'absolute flex items-center justify-center rounded-2xl border border-white/15 bg-white/10 text-white shadow-2xl backdrop-blur-md';
  return (
    <div aria-hidden className={compact ? 'relative mx-auto h-40 w-56' : 'relative h-72 w-72'}>
      <div className="absolute inset-4 rounded-full bg-gradient-to-br from-[#4F8BFF]/60 via-[#8B5CF6]/60 to-[#E056C8]/60 blur-3xl" />
      <div className={`${tile} ${compact ? 'left-20 top-2 size-16' : 'left-28 top-4 size-24'} rotate-6`}>
        <LockKeyhole className={compact ? 'size-7' : 'size-10'} />
      </div>
      <div className={`${tile} ${compact ? 'left-6 top-16 size-14' : 'left-6 top-28 size-20'} -rotate-6`}>
        <MessageSquareText className={compact ? 'size-6' : 'size-8'} />
      </div>
      <div className={`${tile} ${compact ? 'right-4 top-20 size-14' : 'right-2 top-40 size-20'} rotate-3`}>
        <Phone className={compact ? 'size-6' : 'size-8'} />
      </div>
    </div>
  );
}

/**
 * Split hero layout for login / OTP (desktop), single column on mobile.
 * `showHeroOnMobile` renders the compact headline + art above the form (login only).
 */
export function AuthLayout({ children, showHeroOnMobile = false }: { children: ReactNode; showHeroOnMobile?: boolean }) {
  return (
    <div className="flex min-h-dvh bg-bg p-0 lg:items-center lg:justify-center lg:p-8" data-theme-surface>
      <div className="flex w-full max-w-6xl overflow-hidden lg:min-h-[620px] lg:rounded-[28px] lg:border lg:border-border">
        {/* Desktop hero */}
        <section className="relative hidden flex-1 flex-col justify-between overflow-hidden bg-[radial-gradient(120%_120%_at_0%_0%,#1B1540_0%,#0E0B24_45%,#0B0B14_100%)] p-10 text-white lg:flex">
          <Logo tagline inverted />
          <div className="flex items-end justify-between gap-6">
            <div className="max-w-md">
              <h1 className="text-4xl leading-tight font-bold tracking-tight">
                {t('auth.headline1')}
                <br />
                {t('auth.headline2')}
              </h1>
              <p className="mt-4 text-lg text-white/75">{t('auth.subline')}</p>
              <ul className="mt-8 flex flex-col gap-5">
                {features.map(({ icon: Icon, title, body, tone }) => (
                  <li key={title} className="flex gap-4">
                    <span className={`inline-flex size-11 shrink-0 items-center justify-center rounded-xl ${tone}`}>
                      <Icon className="size-5" aria-hidden />
                    </span>
                    <span>
                      <span className="block font-semibold">{title}</span>
                      <span className="text-sm text-white/65">{body}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden xl:block">
              <HeroArt />
            </div>
          </div>
        </section>

        {/* Form column */}
        <section className="flex w-full flex-col px-5 pt-8 pb-6 lg:w-[440px] lg:shrink-0 lg:bg-surface-1 lg:px-10 lg:py-10">
          {showHeroOnMobile && (
            <div className="mb-6 text-center lg:hidden">
              <Logo tagline size={48} className="flex-col" />
              <h1 className="mt-6 text-3xl leading-tight font-bold tracking-tight">
                {t('auth.headline1')}
                <br />
                {t('auth.headline2')}
              </h1>
              <p className="mx-auto mt-3 max-w-xs text-sm text-muted">{t('auth.subline')}</p>
              <HeroArt compact />
            </div>
          )}
          <div className="flex flex-1 flex-col lg:justify-center">{children}</div>
          <AdultsOnlyFooter />
        </section>
      </div>
    </div>
  );
}
