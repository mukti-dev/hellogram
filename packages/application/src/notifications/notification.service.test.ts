import type { NativePushSender, NativePushTokenRecord, NativePushTokenRepository, PushPayload, PushSubscriptionRepository } from '@hellogram/domain';
import { describe, expect, it } from 'vitest';
import { NotificationService, wantsToken } from './notification.service.js';

const tokens: NativePushTokenRecord[] = [
  { id: 'ios-voip', sessionId: 'iphone', platform: 'ios', kind: 'voip', token: 'v'.repeat(64) },
  { id: 'ios-alert', sessionId: 'iphone', platform: 'ios', kind: 'alert', token: 'a'.repeat(64) },
  { id: 'android', sessionId: 'pixel', platform: 'android', kind: 'alert', token: 'f'.repeat(80) },
  // An iPhone on Firebase only (no PushKit token): calls arrive as a normal notification.
  { id: 'ipad-fcm', sessionId: 'ipad', platform: 'ios', kind: 'alert', token: 'i'.repeat(150) },
];

const noBrowsers = { listForAccount: async () => [] } as unknown as PushSubscriptionRepository;

const setup = (result: 'ok' | 'gone' = 'ok') => {
  const sent: string[] = [];
  const deleted: string[] = [];
  const repo = {
    listForAccount: async () => tokens,
    deleteById: async (id: string) => void deleted.push(id),
  } as unknown as NativePushTokenRepository;
  const sender: NativePushSender = {
    send: async (token) => {
      sent.push(token.id);
      return result;
    },
  };
  const service = new NotificationService({ subscriptions: noBrowsers, sender: null, nativeTokens: repo, nativeSender: sender });
  return { service, sent, deleted };
};

const call: PushPayload = { kind: 'call', callId: 'c1', title: 'Incoming call', body: '', url: '/inbox?call=c1' };
const message: PushPayload = { title: 'Amit', body: 'Hi', url: '/inbox/x' };

describe('phone push routing', () => {
  it('rings an iPhone with PushKit through VoIP, and everything else through Firebase', async () => {
    const { service, sent } = setup();
    expect(await service.sendToAccount('acc', call)).toBe(3);
    expect(sent).toEqual(['ios-voip', 'android', 'ipad-fcm']);
  });

  it('sends everything else to the iPhone alert token, never VoIP (iOS rejects VoIP pushes without a call)', async () => {
    const { service, sent } = setup();
    await service.sendToAccount('acc', message);
    await service.sendToAccount('acc', { ...call, kind: 'call_ended' });
    expect(sent).toEqual(['ios-alert', 'android', 'ipad-fcm', 'ios-alert', 'android', 'ipad-fcm']);
  });

  it('forgets tokens the push service says are gone', async () => {
    const { service, deleted } = setup('gone');
    expect(await service.sendToAccount('acc', message)).toBe(0);
    expect(deleted).toEqual(['ios-alert', 'android', 'ipad-fcm']);
  });

  it('keeps tokens but sends nothing until a sender is configured', async () => {
    const service = new NotificationService({ subscriptions: noBrowsers, sender: null, nativeTokens: {} as NativePushTokenRepository, nativeSender: null });
    expect(await service.sendToAccount('acc', call)).toBe(0);
    expect(wantsToken({ platform: 'ios', kind: 'voip', sessionId: 's' }, message)).toBe(false);
  });
});
