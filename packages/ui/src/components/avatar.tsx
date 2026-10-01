import { cn } from '../cn.js';

export interface AvatarProps {
  name: string;
  src?: string | null;
  size?: number;
  className?: string;
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('') || '?';

export function Avatar({ name, src, size = 44, className }: AvatarProps) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.38) };
  if (src) {
    return (
      <img
        src={src}
        alt=""
        style={style}
        className={cn('shrink-0 rounded-full object-cover', className)}
      />
    );
  }
  return (
    <span
      aria-hidden
      style={style}
      className={cn(
        'inline-flex shrink-0 items-center justify-center rounded-full bg-surface-3 font-semibold text-muted',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}
