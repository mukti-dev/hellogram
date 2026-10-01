import { cn } from '@hellogram/ui';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { Outlet, useLocation } from 'react-router';
import { CheckoutDialog } from '../../features/billing/CheckoutDialog.js';
import { CallOverlay } from '../../features/calls/components/CallOverlay.js';
import { UnlockScreen } from '../../features/pin/components/UnlockScreen.js';
import { startUnlockExpiry } from '../../features/pin/model/unlock-tokens.js';
import { BottomTabs } from './BottomTabs.js';
import { Sidebar } from './Sidebar.js';

/**
 * Signed-in shell. Desktop: sidebar + content (list / chat / details panes come
 * with the Inbox in Phase 5). Mobile: content + bottom tab bar.
 */
export function AppShell() {
  const path = useLocation().pathname;
  // The inbox manages its own scrolling panes; an open chat hides the mobile tab bar.
  const immersive = /^\/inbox(\/(?!requests)[^/]+)?/.test(path) && path !== '/inbox/requests';
  const inChat = /^\/inbox\/(?!requests)[^/]+/.test(path);
  const client = useQueryClient();
  useEffect(() => startUnlockExpiry(() => void client.invalidateQueries()), [client]);
  return (
    <div className="flex h-dvh overflow-hidden bg-bg text-fg">
      <Sidebar />
      <main className={cn('min-w-0 flex-1', immersive ? 'overflow-hidden' : 'overflow-y-auto pb-24 lg:pb-0')}>
        <Outlet />
      </main>
      {!inChat && <BottomTabs />}
      <UnlockScreen />
      <CallOverlay />
      <CheckoutDialog />
    </div>
  );
}
