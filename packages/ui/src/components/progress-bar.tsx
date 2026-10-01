import { cn } from '../cn.js';

export interface ProgressBarProps {
  value: number;
  max: number;
  label: string;
  className?: string;
}

export function ProgressBar({ value, max, label, className }: ProgressBarProps) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className={cn('h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)}
    >
      <div className="h-full rounded-full bg-gradient-primary" style={{ width: `${pct}%` }} />
    </div>
  );
}
