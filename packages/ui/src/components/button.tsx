import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { cn } from '../cn.js';

type Variant = 'gradient' | 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  leftIcon?: ReactNode;
  rightIcon?: ReactNode;
  fullWidth?: boolean;
}

const variants: Record<Variant, string> = {
  gradient: 'bg-gradient-primary text-white shadow-[0_8px_24px_-8px_rgba(139,92,246,0.6)] hover:brightness-110',
  primary: 'bg-primary text-white hover:brightness-110',
  secondary: 'bg-surface-2 text-fg hover:bg-surface-3',
  outline: 'border border-border bg-transparent text-fg hover:bg-surface-2',
  ghost: 'bg-transparent text-fg hover:bg-surface-2',
  danger: 'bg-danger text-white hover:brightness-110',
};

const sizes: Record<Size, string> = {
  sm: 'h-9 px-3 text-sm gap-1.5',
  md: 'h-11 px-4 text-sm gap-2',
  lg: 'h-12 px-5 text-base gap-2',
};

export function Button({
  variant = 'primary',
  size = 'md',
  leftIcon,
  rightIcon,
  fullWidth,
  className,
  children,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(
        'inline-flex select-none items-center justify-center rounded-md font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        variants[variant],
        sizes[size],
        fullWidth && 'w-full',
        className,
      )}
      {...rest}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </button>
  );
}

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Required: icon-only buttons need a screen-reader label. */
  label: string;
}

export function IconButton({ label, className, children, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        'inline-flex size-11 items-center justify-center rounded-full text-muted transition hover:bg-surface-2 hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}
