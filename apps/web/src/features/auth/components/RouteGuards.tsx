import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { refreshAccessToken } from '../../../core/http/client.js';
import { t } from '../../../i18n/t.js';
import { useAuthStore } from '../model/auth-store.js';
import { nextPath } from '../model/next-path.js';

/** On first load, try the refresh cookie to restore the session (the access token lives in memory only). */
export function useSessionBootstrap(): void {
  const status = useAuthStore((s) => s.status);
  useEffect(() => {
    if (status === 'unknown') void refreshAccessToken();
  }, [status]);
}

function Splash() {
  return (
    <div className="flex h-dvh items-center justify-center bg-bg text-sm text-muted" role="status">
      {t('common.loading')}
    </div>
  );
}

export function RequireAuth({ children }: { children: ReactNode }) {
  useSessionBootstrap();
  const status = useAuthStore((s) => s.status);
  const location = useLocation();
  if (status === 'unknown') return <Splash />;
  if (status === 'anonymous') {
    const next = `${location.pathname}${location.search}`;
    return <Navigate to={next === '/' ? '/login' : `/login?next=${encodeURIComponent(next)}`} replace />;
  }
  return children;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  useSessionBootstrap();
  const status = useAuthStore((s) => s.status);
  const { search } = useLocation();
  if (status === 'unknown') return <Splash />;
  if (status === 'authenticated') return <Navigate to={nextPath(search)} replace />;
  return children;
}
