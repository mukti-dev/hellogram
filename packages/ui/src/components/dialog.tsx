import * as RadixDialog from '@radix-ui/react-dialog';
import { X } from './icons.js';
import type { ReactNode } from 'react';
import { cn } from '../cn.js';

export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: ReactNode;
  children?: ReactNode;
  className?: string;
}

/** Accessible modal (focus trap, Esc to close). Bottom sheet on mobile, centered on desktop. */
export function Dialog({ open, onOpenChange, title, description, children, className }: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm" />
        <RadixDialog.Content
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 max-h-[90dvh] overflow-y-auto rounded-t-xl border border-border bg-surface-1 p-5 text-fg shadow-2xl',
            'sm:inset-auto sm:top-1/2 sm:left-1/2 sm:w-[min(92vw,440px)] sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl',
            className,
          )}
        >
          <div className="flex items-start justify-between gap-4">
            <RadixDialog.Title className="text-lg font-bold">{title}</RadixDialog.Title>
            <RadixDialog.Close
              aria-label="Close"
              className="-mt-1 -mr-1 inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
            >
              <X />
            </RadixDialog.Close>
          </div>
          {description ? (
            <RadixDialog.Description className="mt-1 text-sm text-muted">{description}</RadixDialog.Description>
          ) : (
            <RadixDialog.Description className="sr-only">{title}</RadixDialog.Description>
          )}
          <div className="mt-4">{children}</div>
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  );
}
