import type { HTMLAttributes } from 'react';
import { cn } from '../cn.js';

export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-lg border border-border bg-surface-1', className)} {...rest} />;
}
