import { Avatar, Button, Card, cn } from '@hellogram/ui';
import { ChevronRight, Crown, LogOut, Monitor, Moon, Sun } from 'lucide-react';
import { Link } from 'react-router';
import { PageHeader } from '../../../app/layouts/PageHeader.js';
import { useThemeStore, type ThemePreference } from '../../../app/theme/theme-store.js';
import { t } from '../../../i18n/t.js';
import { formatPhone, useLogout, useMe } from '../../auth/model/queries.js';
import { BlockedSection } from '../components/BlockedSection.js';
import { NotificationsSection } from '../components/NotificationsSection.js';
import { PrivacySection } from '../components/PrivacySection.js';

const options: { value: ThemePreference; icon: typeof Sun }[] = [
  { value: 'system', icon: Monitor },
  { value: 'light', icon: Sun },
  { value: 'dark', icon: Moon },
];

export function SettingsPage() {
  const preference = useThemeStore((s) => s.preference);
  const setPreference = useThemeStore((s) => s.setPreference);
  const me = useMe();
  const logout = useLogout();

  return (
    <div className="mx-auto w-full max-w-3xl">
      <PageHeader title={t('settings.title')} />
      <div className="flex flex-col gap-4 px-4 pb-8 lg:px-8">
        <Link to="/settings/profile" className="block" aria-label={t('profile.open')}>
          <Card className="flex items-center gap-3 p-4 hover:border-primary/50">
            <Avatar name={me.data?.name ?? t('common.myAccount')} size={48} />
            <div className="min-w-0 flex-1">
              <p className="font-semibold">{t('profile.title')}</p>
              <p className="truncate text-sm text-muted">{me.data ? formatPhone(me.data.phone) : ' '}</p>
              <p className="truncate text-xs text-muted">{t('profile.subtitle')}</p>
            </div>
            <ChevronRight className="size-4 text-muted" aria-hidden />
          </Card>
        </Link>
        <NotificationsSection />
        <Link to="/settings/billing" className="block">
          <Card className="flex items-center gap-3 p-4 hover:border-primary/50">
            <Crown className="size-5 text-label-olx" aria-hidden />
            <span className="flex-1 text-sm font-semibold">{t('settings.billing')}</span>
            <ChevronRight className="size-4 text-muted" aria-hidden />
          </Card>
        </Link>
        <BlockedSection />
        <PrivacySection />
        <Card className="p-4">
          <h2 id="appearance" className="text-sm font-semibold">
            {t('settings.appearance')}
          </h2>
          <div role="radiogroup" aria-labelledby="appearance" className="mt-3 grid grid-cols-3 gap-2">
            {options.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={preference === value}
                onClick={() => setPreference(value)}
                className={cn(
                  'flex h-20 flex-col items-center justify-center gap-2 rounded-md border text-sm font-medium transition',
                  preference === value
                    ? 'border-primary bg-primary-soft text-fg'
                    : 'border-border text-muted hover:bg-surface-2',
                )}
              >
                <Icon className="size-5" aria-hidden />
                {t(`settings.theme.${value}`)}
              </button>
            ))}
          </div>
          <p className="mt-3 text-xs text-muted">{t('settings.themeHint')}</p>
        </Card>
        <Button
          variant="outline"
          fullWidth
          leftIcon={<LogOut className="size-4" aria-hidden />}
          onClick={() => logout.mutate()}
          disabled={logout.isPending}
        >
          {t('account.logout')}
        </Button>
      </div>
    </div>
  );
}
