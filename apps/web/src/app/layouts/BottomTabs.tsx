import { CountBadge, cn } from '@hellogram/ui';
import { NavLink } from 'react-router';
import { useUnreadTotal } from '../../features/inbox/model/unread.js';
import { t } from '../../i18n/t.js';
import { navItems } from './nav-items.js';

/** Mobile / tablet (< 1024px) bottom tab bar: Inbox · Numbers · Calls · Settings. */
export function BottomTabs() {
  const unread = useUnreadTotal();
  return (
    <nav
      aria-label={t('nav.mainNavigation')}
      className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface-1/95 pb-[env(safe-area-inset-bottom)] backdrop-blur lg:hidden"
    >
      <ul className="mx-auto grid max-w-lg grid-cols-4">
        {navItems.map(({ to, labelKey, icon: Icon, badge }) => (
          <li key={to}>
            <NavLink
              to={to}
              className={({ isActive }) =>
                cn(
                  'flex h-16 flex-col items-center justify-center gap-1 text-[11px] font-medium',
                  isActive ? 'text-fg' : 'text-muted',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      'relative inline-flex size-8 items-center justify-center rounded-md',
                      isActive && 'bg-primary text-white',
                    )}
                  >
                    <Icon className="size-5" aria-hidden />
                    {badge === 'unread' && (
                      <CountBadge
                        count={unread}
                        label={`${unread} unread`}
                        className="absolute -right-2 -top-1.5 h-4 min-w-4 text-[10px]"
                      />
                    )}
                  </span>
                  {t(labelKey)}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
