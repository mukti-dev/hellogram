import { Button, Card } from '@hellogram/ui';
import { LogOut, Monitor, Smartphone } from 'lucide-react';
import { t } from '../../../i18n/t.js';
import { useLogout, useRevokeSession, useSessions } from '../../auth/model/queries.js';

const relative = (iso: string) => {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString();
};

export function DevicesSection() {
  const sessions = useSessions();
  const revoke = useRevokeSession();
  const logout = useLogout();

  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{t('account.devices')}</h2>
      <ul className="mt-2 divide-y divide-border">
        {sessions.data?.items.map((session) => {
          const name = session.deviceName ?? t('account.unknownDevice');
          const Icon = /iOS|Android/.test(name) ? Smartphone : Monitor;
          return (
            <li key={session.id} className="flex items-center gap-3 py-3">
              <Icon className="size-5 text-muted" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{name}</p>
                <p className="text-xs text-muted">
                  {session.current ? (
                    <span className="font-semibold text-success">{t('account.thisDevice')}</span>
                  ) : (
                    t('account.lastActive', { when: relative(session.lastSeenAt) })
                  )}
                </p>
              </div>
              {!session.current && (
                <Button
                  variant="outline"
                  size="sm"
                  aria-label={t('account.logoutDeviceLabel', { device: name })}
                  disabled={revoke.isPending}
                  onClick={() => revoke.mutate(session.id)}
                >
                  {t('account.logoutDevice')}
                </Button>
              )}
            </li>
          );
        })}
      </ul>
      <Button
        variant="outline"
        fullWidth
        className="mt-2 text-danger"
        leftIcon={<LogOut className="size-4" aria-hidden />}
        onClick={() => logout.mutate()}
        disabled={logout.isPending}
      >
        {t('account.logout')}
      </Button>
    </Card>
  );
}
