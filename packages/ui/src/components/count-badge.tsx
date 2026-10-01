import { cn } from '../cn.js';

export interface CountBadgeProps {
  count: number;
  className?: string;
  /** Screen-reader text, e.g. "3 unread". */
  label?: string;
}

export function CountBadge({ count, className, label }: CountBadgeProps) {
  if (count <= 0) return null;
  return (
    <span
      className={cn(
        'inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-danger px-1.5 text-[11px] font-bold text-white',
        className,
      )}
      aria-label={label ?? `${count}`}
    >
      {count > 99 ? '99+' : count}
    </span>
  );
}
