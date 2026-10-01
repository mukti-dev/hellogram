import * as Menu from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '../cn.js';

export interface MenuItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface DropdownMenuProps {
  trigger: ReactNode;
  items: MenuItem[];
  align?: 'start' | 'end';
}

/** Kebab menus (number cards, chat header). Full keyboard support via Radix. */
export function DropdownMenu({ trigger, items, align = 'end' }: DropdownMenuProps) {
  return (
    <Menu.Root>
      <Menu.Trigger asChild>{trigger}</Menu.Trigger>
      <Menu.Portal>
        <Menu.Content
          align={align}
          sideOffset={6}
          className="z-50 min-w-48 rounded-md border border-border bg-surface-2 p-1 text-sm text-fg shadow-xl"
        >
          {items.map((item) => (
            <Menu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.onSelect}
              className={cn(
                'flex h-10 cursor-pointer items-center gap-2.5 rounded px-3 outline-none select-none',
                'data-[highlighted]:bg-surface-3 data-[disabled]:opacity-50',
                item.danger && 'text-danger',
              )}
            >
              {item.icon}
              {item.label}
            </Menu.Item>
          ))}
        </Menu.Content>
      </Menu.Portal>
    </Menu.Root>
  );
}
