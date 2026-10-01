import * as RadixSwitch from '@radix-ui/react-switch';
import { cn } from '../cn.js';

export interface SwitchProps {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  className?: string;
}

export function Switch({ checked, onCheckedChange, label, disabled, className }: SwitchProps) {
  return (
    <RadixSwitch.Root
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
      className={cn(
        'relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition',
        'bg-surface-3 data-[state=checked]:bg-primary disabled:opacity-50',
        className,
      )}
    >
      <RadixSwitch.Thumb className="block size-5 translate-x-1 rounded-full bg-white shadow transition data-[state=checked]:translate-x-6" />
    </RadixSwitch.Root>
  );
}
