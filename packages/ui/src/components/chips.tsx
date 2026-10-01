import type { HTMLAttributes } from 'react';
import { cn } from '../cn.js';

export type LabelKind = 'olx' | 'dating' | 'tenants' | 'other';

const labelStyles: Record<LabelKind, string> = {
  olx: 'bg-label-olx/15 text-label-olx',
  dating: 'bg-label-dating/15 text-label-dating',
  tenants: 'bg-label-tenants/15 text-label-tenants',
  other: 'bg-label-other/15 text-label-other',
};

const DEFAULT_LABEL_TEXT: Record<LabelKind, string> = {
  olx: 'OLX',
  dating: 'Dating',
  tenants: 'Tenants',
  other: 'Other',
};

export interface LabelChipProps extends HTMLAttributes<HTMLSpanElement> {
  kind: LabelKind;
  /** Custom text for `other` labels. */
  text?: string;
  /** Renders "via OLX" as used in inbox and chat headers. */
  prefix?: string;
}

export function LabelChip({ kind, text, prefix, className, ...rest }: LabelChipProps) {
  return (
    <span
      className={cn(
        'inline-flex h-5 items-center rounded-full px-2 text-[11px] font-semibold leading-none',
        labelStyles[kind],
        className,
      )}
      {...rest}
    >
      {prefix ? `${prefix} ` : ''}
      {text ?? DEFAULT_LABEL_TEXT[kind]}
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

/** Inbox label filters (All / OLX / Dating / Tenants / Unread). */
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
