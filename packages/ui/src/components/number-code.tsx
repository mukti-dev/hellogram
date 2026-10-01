import { cn } from '../cn.js';

export interface NumberCodeProps {
  code: string;
  className?: string;
}

/** Number codes are always shown exactly as stored, in monospace (e.g. A482719K). */
export function NumberCode({ code, className }: NumberCodeProps) {
  return <span className={cn('font-mono tracking-wider', className)}>{code}</span>;
}
