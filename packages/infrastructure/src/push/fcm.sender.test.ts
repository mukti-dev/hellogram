import type { NativePushTokenRecord, PushPayload } from '@hellogram/domain';
import { exportPKCS8, generateKeyPair } from 'jose';
import { describe, expect, it } from 'vitest';
import { FcmSender, buildMessage, parseServiceAccount } from './fcm.sender.js';

const token: NativePushTokenRecord = { id: 't1', sessionId: 's1', platform: 'android', kind: 'alert', token: 'fcm-token-1' };
const message: PushPayload = { title: 'Amit', body: 'Hi there', url: '/inbox/c1', tag: 'c1' };

async function setup(sendStatus = 200, sendBody: unknown = { name: 'projects/p/messages/1' }) {
  const { privateKey } = await generateKeyPair('RS256', { extractable: true });
  const account = { project_id: 'hellogram-test', client_email: 'push@hellogram-test.iam.gserviceaccount.com', private_key: await exportPKCS8(privateKey) };
  const calls: { url: string; body: string }[] = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: String(init.body) });
    if (url.includes('oauth2')) return new Response(JSON.stringify({ access_token: 'ya29.test', expires_in: 3600 }));
    return new Response(JSON.stringify(sendBody), { status: sendStatus });
  }) as typeof fetch;
  return { sender: new FcmSender(account, fetchImpl), calls };
}

describe('FcmSender', () => {
  it('signs in with the service account once and sends to the project', async () => {
    const { sender, calls } = await setup();
    expect(await sender.send(token, message)).toBe('ok');
    expect(await sender.send(token, message)).toBe('ok');
    expect(calls.filter((c) => c.url.includes('oauth2'))).toHaveLength(1);
    const sent = calls.find((c) => c.url.includes('/projects/hellogram-test/messages:send'));
    expect(JSON.parse(sent!.body).message).toMatchObject({ token: 'fcm-token-1', notification: { title: 'Amit', body: 'Hi there' }, data: { url: '/inbox/c1' } });
  });

  it('forgets uninstalled apps (UNREGISTERED) and throws on other errors', async () => {
    const gone = await setup(404, { error: { status: 'NOT_FOUND', details: [{ errorCode: 'UNREGISTERED' }] } });
    expect(await gone.sender.send(token, message)).toBe('gone');
    const down = await setup(503, { error: { status: 'UNAVAILABLE' } });
    await expect(down.sender.send(token, message)).rejects.toThrow('503');
  });
});

describe('FCM message shape', () => {
  it('rings calls loudly and replaces them with "Missed call" via the same tag', () => {
    const ring = buildMessage('t', { kind: 'call', callId: 'k1', title: 'Incoming call from Amit', body: 'to A123', url: '/inbox?call=k1', tag: 'call-k1', ttlSeconds: 45 });
    expect(ring).toMatchObject({
      data: { kind: 'call', callId: 'k1' },
      android: { priority: 'HIGH', ttl: '45s', notification: { channel_id: 'calls', tag: 'call-k1' } },
      apns: { headers: { 'apns-collapse-id': 'call-k1' }, payload: { aps: { 'interruption-level': 'time-sensitive' } } },
    });
    const missed = buildMessage('t', { kind: 'call_ended', missed: true, callId: 'k1', title: 'Missed call', body: '', url: '/calls', tag: 'call-k1' });
    expect(missed).toMatchObject({ notification: { title: 'Missed call' }, android: { notification: { channel_id: 'messages', tag: 'call-k1' } } });
  });

  it('sends a call answered elsewhere as data only (nothing to show)', () => {
    const quiet = buildMessage('t', { kind: 'call_answered', callId: 'k1', title: 'Call ended', body: '', url: '/calls' });
    expect(quiet).not.toHaveProperty('notification');
    expect(quiet).toMatchObject({ data: { kind: 'call_answered' }, apns: { payload: { aps: { 'content-available': 1 } } } });
  });

  it('reads the key file as JSON or base64', () => {
    const json = JSON.stringify({ project_id: 'p', client_email: 'e', private_key: 'k', type: 'service_account' });
    expect(parseServiceAccount(json)).toEqual({ project_id: 'p', client_email: 'e', private_key: 'k' });
    expect(parseServiceAccount(Buffer.from(json).toString('base64'))).toEqual({ project_id: 'p', client_email: 'e', private_key: 'k' });
    expect(() => parseServiceAccount('{}')).toThrow('FCM_SERVICE_ACCOUNT');
  });
});
