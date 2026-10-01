import { useId } from 'react';
import { cn } from '../cn.js';

export interface LogoProps {
  size?: number;
  withWordmark?: boolean;
  tagline?: boolean;
  /** White wordmark for use on dark hero backgrounds regardless of theme. */
  inverted?: boolean;
  className?: string;
}

/** Gradient "petal" mark + wordmark, as in the designs. */
export function Logo({ size = 32, withWordmark = true, tagline = false, inverted = false, className }: LogoProps) {
  const id = useId();
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      <svg width={size} height={size} viewBox="0 0 40 40" aria-hidden>
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#4F8BFF" />
            <stop offset="1" stopColor="#8B5CF6" />
          </linearGradient>
          <linearGradient id={`${id}-b`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#E056C8" />
            <stop offset="1" stopColor="#F59E0B" />
          </linearGradient>
        </defs>
        <path d="M6 20c0-8 6-14 14-14 2 0 3 1 3 3v22c0 2-1 3-3 3-8 0-14-6-14-14z" fill={`url(#${id}-a)`} />
        <path d="M17 12c0-4 3-7 7-7 6 0 11 5 11 11v6c0 7-6 13-13 13-3 0-5-2-5-5V12z" fill={`url(#${id}-b)`} opacity="0.9" />
      </svg>
      {withWordmark && (
        <span className="flex flex-col leading-tight">
          <span className={cn('text-lg font-bold tracking-tight', inverted ? 'text-white' : 'text-fg')}>Hellogram</span>
          {tagline && (
            <span className={cn('text-[11px]', inverted ? 'text-white/70' : 'text-muted')}>Private Calls &amp; Chats</span>
          )}
        </span>
      )}
    </span>
  );
}
