import { Logo, cn } from '@hellogram/ui';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, FileWarning, Gauge, Gavel, LogOut, Search, ScrollText } from 'lucide-react';
import { NavLink, Navigate, Outlet } from 'react-router';
import { adminApi, session } from './api.js';

export interface AdminMe {
  id: string;
  email: string;
  role: 'moderator' | 'admin' | 'grievance_officer';
}

const nav = [
  { to: '/', label: 'Dashboard', icon: Gauge, roles: ['moderator', 'admin', 'grievance_officer'] },
  { to: '/reports', label: 'Reports', icon: FileWarning, roles: ['moderator', 'admin', 'grievance_officer'] },
  { to: '/lookup', label: 'Account lookup', icon: Search, roles: ['moderator', 'admin', 'grievance_officer'] },
  { to: '/grievances', label: 'Grievances', icon: ClipboardList, roles: ['admin', 'grievance_officer'] },
  { to: '/legal', label: 'Legal requests', icon: Gavel, roles: ['admin', 'grievance_officer'] },
  { to: '/audit', label: 'Audit log', icon: ScrollText, roles: ['admin'] },
];

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: () => adminApi<AdminMe>('/me') });
}

export function Layout() {
  const me = useMe();
  if (!session.get()) return <Navigate to="/login" replace />;
  if (!me.data) return <div className="p-8 text-sm text-muted">Loading…</div>;

  return (
    <div className="flex min-h-dvh bg-bg text-fg">
      <aside className="flex w-60 shrink-0 flex-col border-r border-border bg-surface-1 p-4">
        <Logo />
        <p className="mt-1 px-1 text-xs font-semibold tracking-wide text-danger uppercase">Admin · restricted</p>
        <nav className="mt-6 flex flex-col gap-1">
          {nav
            .filter((n) => n.roles.includes(me.data.role))
            .map(({ to, label, icon: Icon }) => (
              <NavLink
                key={to}
                to={to}
                end={to === '/'}
                className={({ isActive }) =>
                  cn('flex h-10 items-center gap-3 rounded-md px-3 text-sm', isActive ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2')
                }
              >
                <Icon className="size-4" aria-hidden />
                {label}
              </NavLink>
            ))}
        </nav>
        <div className="mt-auto border-t border-border pt-3 text-xs text-muted">
          <p className="truncate">{me.data.email}</p>
          <p className="capitalize">{me.data.role.replace('_', ' ')}</p>
          <button
            type="button"
            onClick={() => {
              session.set(null);
              window.location.assign('/login');
            }}
            className="mt-2 flex items-center gap-2 text-fg hover:text-danger"
          >
            <LogOut className="size-4" aria-hidden /> Log out
          </button>
        </div>
      </aside>
      <main className="min-w-0 flex-1 p-6">
        <Outlet />
      </main>
    </div>
  );
}
