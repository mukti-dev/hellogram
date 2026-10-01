import { usePendingCount } from '../../requests/model/queries.js';
import { useUnreadChats } from './unread-chats.js';

/** Nav badge: unread chats + pending contact requests. */
export function useUnreadTotal(): number {
  const pending = usePendingCount().data ?? 0;
  return pending + useUnreadChats();
}
