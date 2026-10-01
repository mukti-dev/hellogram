import { Avatar, Button, CountBadge, DropdownMenu, Logo, ProgressBar, cn } from '@hellogram/ui';
import { Crown, EllipsisVertical, LogOut, Plus, Settings as SettingsIcon, UserRound } from 'lucide-react';
import { Link, NavLink, useNavigate } from 'react-router';
import { formatPhone, useLogout, useMe } from '../../features/auth/model/queries.js';
import { useNumbers } from '../../features/numbers/model/queries.js';
import { useUnreadTotal } from '../../features/inbox/model/unread.js';
import { t } from '../../i18n/t.js';
import { navItems } from './nav-items.js';

/** Desktop (≥ 1024px) left sidebar, as in the desktop designs. */
export function Sidebar() {
  const me = useMe();
  const navigate = useNavigate();
  const logout = useLogout();
  const plan = useNumbers().data?.plan;
  const unread = useUnreadTotal();
  return (
    <aside className="hidden w-60 shrink-0 flex-col border-r border-border bg-surface-1 px-4 py-5 lg:flex">
      <Logo className="px-2" />

      <Button
        variant="gradient"
        fullWidth
        className="mt-6"
        disabled={plan ? plan.used >= plan.max : false}
        onClick={() => navigate('/numbers/new')}
        leftIcon={<Plus className="size-4" aria-hidden />}
      >
        {t('nav.addNumber')}
      </Button>

      <nav aria-label={t('nav.mainNavigation')} className="mt-6 flex flex-col gap-1">
        {navItems.map(({ to, labelKey, icon: Icon, badge }) => (
          <NavLink
            key={to}
            to={to}
            className={({ isActive }) =>
              cn(
                'flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition',
                isActive ? 'bg-surface-3 text-fg' : 'text-muted hover:bg-surface-2 hover:text-fg',
              )
            }
          >
            {({ isActive }) => (
              <>
                <Icon className={cn('size-5', isActive && 'text-label-dating')} aria-hidden />
                <span className="flex-1">{t(labelKey)}</span>
                {badge === 'unread' && <CountBadge count={unread} label={`${unread} unread`} />}
              </>
            )}
          </NavLink>
        ))}
      </nav>

      <div className="mt-auto flex flex-col gap-4">
        {plan && (
        <section className="rounded-lg bg-surface-2 p-4" aria-label={t('plan.usage')}>
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 items-center justify-center rounded-md bg-label-olx/15">
              <Crown className="size-5 text-label-olx" aria-hidden />
            </span>
            <div className="text-sm">
              <p className="font-semibold">{t('plan.numbersUsed', { used: plan.used, max: plan.max })}</p>
              <p className="text-xs text-muted">{t('plan.freePaid', { free: plan.free, paid: plan.paid })}</p>
            </div>
          </div>
          <ProgressBar value={plan.used} max={plan.max} label={t('plan.usage')} className="mt-3" />
          <Button variant="outline" size="sm" fullWidth className="mt-3" onClick={() => navigate('/settings/billing')}>
            {t('plan.manage')}
          </Button>
        </section>
        )}

        <div className="flex items-center gap-1">
          <Link
            to="/settings/profile"
            aria-label={t('profile.open')}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-md px-1 py-1 hover:bg-surface-2"
          >
            <Avatar name={me.data?.name ?? t('common.myAccount')} size={40} />
            <div className="min-w-0 flex-1 text-sm">
              <p className="truncate font-semibold">{me.data?.name ?? t('common.myAccount')}</p>
              <p className="truncate text-xs text-muted">{me.data ? formatPhone(me.data.phone) : ' '}</p>
            </div>
          </Link>
          <DropdownMenu
            trigger={
              <button
                type="button"
                aria-label={t('common.more')}
                className="inline-flex size-9 items-center justify-center rounded-full text-muted hover:bg-surface-2"
              >
                <EllipsisVertical className="size-4" aria-hidden />
              </button>
            }
            items={[
              { label: t('profile.title'), icon: <UserRound className="size-4" aria-hidden />, onSelect: () => navigate('/settings/profile') },
              { label: t('profile.settings'), icon: <SettingsIcon className="size-4" aria-hidden />, onSelect: () => navigate('/settings') },
              { label: t('account.logout'), icon: <LogOut className="size-4" aria-hidden />, onSelect: () => logout.mutate(), danger: true },
            ]}
          />
        </div>
      </div>
    </aside>
  );
}
