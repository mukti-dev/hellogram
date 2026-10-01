import type { ReactNode } from 'react';

export interface PageHeaderProps {
  title: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <header className="flex items-start justify-between gap-4 px-4 pt-6 pb-4 lg:px-8 lg:pt-8">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-muted">{subtitle}</div>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

export function EmptyState({ icon, title, hint }: { icon: ReactNode; title: string; hint: string }) {
  return (
    <div className="mx-auto flex max-w-sm flex-col items-center px-6 py-20 text-center">
      <span className="mb-4 inline-flex size-14 items-center justify-center rounded-full bg-primary-soft text-primary">
        {icon}
      </span>
      <p className="text-base font-semibold">{title}</p>
      <p className="mt-1 text-sm text-muted">{hint}</p>
    </div>
  );
}
