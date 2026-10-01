import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.js';

/** Colour families for a number's label (picked by its icon, so labels look consistent). */
export type LabelTone = 'amber' | 'pink' | 'blue' | 'violet' | 'gray';

const toneStyles: Record<LabelTone, string> = {
  amber: 'bg-label-olx/15 text-label-olx',
  pink: 'bg-label-dating/15 text-label-dating',
  blue: 'bg-label-tenants/15 text-label-tenants',
  violet: 'bg-primary/15 text-primary',
  gray: 'bg-label-other/15 text-label-other',
};

export interface LabelChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** The user's own label text, e.g. "OLX". */
  name: string;
  icon?: ReactNode;
  tone?: LabelTone;
  /** Renders "via OLX" as used in inbox and chat headers. */
  prefix?: string;
}

export function LabelChip({ name, icon, tone = 'gray', prefix, className, ...rest }: LabelChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 max-w-[12rem] items-center gap-1 rounded-full px-2 text-[11px] font-semibold leading-none',
        toneStyles[tone],
        className,
      )}
      {...rest}
    >
      {icon && <span className="inline-flex shrink-0 [&>svg]:size-3">{icon}</span>}
      <span className="truncate">
        {prefix ? `${prefix} ` : ''}
        {name}
      </span>
    </span>
  );
}

export type PersonaStatusKind = 'active' | 'paused' | 'locked';

const statusStyles: Record<PersonaStatusKind, string> = {
  active: 'bg-success/15 text-success',
  paused: 'bg-warning/15 text-warning',
  locked: 'bg-surface-3 text-muted',
};

export interface StatusChipProps extends HTMLAttributes<HTMLSpanElement> {
  status: PersonaStatusKind;
}

export function StatusChip({ status, className, children, ...rest }: StatusChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs font-semibold',
        statusStyles[status],
        className,
      )}
      {...rest}
    >
      {children}
    </span>
  );
}

export interface FilterChipProps extends HTMLAttributes<HTMLButtonElement> {
  selected?: boolean;
}

/** Inbox filters (All / each of the user's own labels / Unread). */
export function FilterChip({ selected, className, ...rest }: FilterChipProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      className={cn(
        'inline-flex h-9 shrink-0 items-center rounded-md border px-3 text-sm font-medium transition',
        selected
          ? 'border-primary bg-primary text-white'
          : 'border-border bg-surface-1 text-fg hover:bg-surface-2',
        className,
      )}
      {...rest}
    />
  );
}
