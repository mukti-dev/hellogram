import { useEffect, type ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';
import { refreshAccessToken } from '../../../core/http/client.js';
import { t } from '../../../i18n/t.js';
import { useAuthStore } from '../model/auth-store.js';

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
  if (status === 'anonymous') return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return children;
}

export function RedirectIfAuthenticated({ children }: { children: ReactNode }) {
  useSessionBootstrap();
  const status = useAuthStore((s) => s.status);
  if (status === 'unknown') return <Splash />;
  if (status === 'authenticated') return <Navigate to="/numbers" replace />;
  return children;
}
