import { Mail, Phone, Settings, Smartphone, type LucideIcon } from 'lucide-react';
import type { MessageKey } from '../../i18n/t.js';

export interface NavItem {
  to: string;
  labelKey: MessageKey;
  icon: LucideIcon;
  badge?: 'unread';
}

/** Contacts is intentionally absent (removed from v1). */
export const navItems: NavItem[] = [
  { to: '/inbox', labelKey: 'nav.inbox', icon: Mail, badge: 'unread' },
  { to: '/numbers', labelKey: 'nav.numbers', icon: Smartphone },
  { to: '/calls', labelKey: 'nav.calls', icon: Phone },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];
