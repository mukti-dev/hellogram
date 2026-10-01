import type { ConversationDto } from '@hellogram/shared';
import { useCallStore } from './call-store.js';

/** Starts a voice call from a chat. */
export function useStartCall(): ((conversation: ConversationDto) => void) | undefined {
  const start = useCallStore((s) => s.startOutgoing);
  return (c) =>
    void start(c.id, {
      name: c.nickname ?? c.counterpart.displayName,
      avatarUrl: c.counterpart.avatarUrl,
      labelIcon: c.me.labelIcon,
      labelName: c.me.labelName,
      code: c.counterpart.code,
    });
}
