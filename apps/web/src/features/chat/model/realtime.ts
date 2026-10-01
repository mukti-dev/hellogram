import type { MessageDto } from '@hellogram/shared';
import { onRealtime } from '../../../core/realtime/handlers.js';
import { getSocket } from '../../../core/realtime/socket.js';
import { useSoundPrefs } from '../../../core/sound/sound-prefs.js';
import { playMessageTone } from '../../../core/sound/tones.js';
import type { ConversationDto } from '@hellogram/shared';
import { bumpStatus, updateMessages, upsertMessage } from './cache.js';
import { chatKeys } from './keys.js';
import { useOutbox } from './outbox.js';
import { useTypingStore } from './typing.js';

/** Socket → query-cache wiring for chat. Imported once at startup. */
onRealtime('message:new', (client) => (payload: { message?: MessageDto; locked?: boolean }) => {
  void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
  void client.invalidateQueries({ queryKey: chatKeys.unread });
  const { message } = payload;
  if (!message) return; // locked number: content-free notification only
  upsertMessage(client, message);
  if (message.mine && message.clientMessageId) useOutbox.getState().remove(message.clientMessageId);
  // ✓✓ as soon as this device has it.
  if (!message.mine) getSocket()?.emit('message:ack', { messageIds: [message.id] });
  if (!message.mine) {
    const conversation = client.getQueryData<ConversationDto>(chatKeys.one(message.conversationId));
    const muted = conversation?.mutedUntil != null && new Date(conversation.mutedUntil).getTime() > Date.now();
    // No sound while I'm already looking at that chat.
    const watching = !document.hidden && window.location.pathname.startsWith(`/inbox/${message.conversationId}`);
    if (!muted && !watching) {
      const { messageTone, vibrate } = useSoundPrefs.getState();
      playMessageTone(messageTone, vibrate);
    }
  }
});

onRealtime('message:delivered', (client) => (p: { conversationId: string; messageIds: string[] }) => {
  const ids = new Set(p.messageIds);
  updateMessages(client, p.conversationId, (m) => (ids.has(m.id) ? bumpStatus(m, 'delivered') : m));
  void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
});

onRealtime('message:read', (client) => (p: { conversationId: string; upToMessageId: string }) => {
  let upToAt: string | null = null;
  updateMessages(client, p.conversationId, (m) => {
    if (m.id === p.upToMessageId) upToAt = m.createdAt;
    return m;
  });
  updateMessages(client, p.conversationId, (m) =>
    m.mine && (!upToAt || m.createdAt <= upToAt) ? bumpStatus(m, 'read') : m,
  );
  void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
});

onRealtime('message:deleted', (client) => (p: { conversationId: string; messageId: string; scope: 'me' | 'everyone' }) => {
  updateMessages(client, p.conversationId, (m) =>
    m.id !== p.messageId ? m : p.scope === 'me' ? null : { ...m, deleted: true, body: null },
  );
  void client.invalidateQueries({ queryKey: ['conversations', 'inbox'] });
});

onRealtime('conversation:updated', (client) => (p: { conversationId?: string }) => {
  if (p.conversationId) {
    void client.invalidateQueries({ queryKey: chatKeys.one(p.conversationId) });
    void client.invalidateQueries({ queryKey: chatKeys.messages(p.conversationId) });
  }
  void client.invalidateQueries({ queryKey: chatKeys.unread });
});

onRealtime('typing', () => (p: { conversationId: string }) => {
  useTypingStore.getState().mark(p.conversationId);
});
