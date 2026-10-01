import { useUnreadChatCount } from '../../chat/model/queries.js';

export function useUnreadChats(): number {
  return useUnreadChatCount().data ?? 0;
}
