import { InMemoryBlobStore } from '@hellogram/infrastructure';
import type { AttachmentDto, InboxDto, MessageDto, MessagePageDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientId, connectedPair } from './fixtures.js';
import { createHarness, type Harness, type User } from './harness.js';

const storage = new InMemoryBlobStore();
let h: Harness;
beforeAll(async () => {
  h = await createHarness({}, { blobs: storage });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  storage.objects.clear();
});

// An audio-only MP4 (M4A) of 4.2 s, with a location in its metadata.
const u32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const str = (s: string) => [...Buffer.from(s, 'latin1')];
const box = (type: string, ...payload: number[][]) => {
  const body = payload.flat();
  return [...u32(body.length + 8), ...str(type), ...body];
};
const M4A = Buffer.from([
  ...box('ftyp', str('M4A '), u32(0), str('isom')),
  ...box(
    'moov',
    box('mvhd', [0, 0, 0, 0], u32(0), u32(0), u32(1000), u32(4200), new Array(80).fill(0)),
    box('trak', box('mdia', box('hdlr', [0, 0, 0, 0], u32(0), str('soun'), new Array(13).fill(0)))),
    box('udta', str('+12.97+077.59/')),
  ),
  ...box('mdat', str('aac-frames')),
]);

const upload = (user: User, conversationId: string, file: Buffer, headers: Record<string, string>) =>
  h.app
    .inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/attachments`,
      headers: { ...user.headers, 'content-type': 'application/octet-stream', 'x-file-name': 'rec.m4a', ...headers },
      payload: file,
    })
    .then((r) => ({ status: r.statusCode, body: r.json() as AttachmentDto & { error?: { code: string } } }));

const send = (user: User, conversationId: string, attachmentId: string) =>
  user.request<MessageDto>({ method: 'POST', url: `/v1/conversations/${conversationId}/messages`, payload: { clientMessageId: clientId(), attachmentId } });

describe('voice messages and GIFs', () => {
  it('sends a voice message with its length and waveform; the inbox calls it a voice message', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const up = await upload(visitor, conversationId, M4A, { 'x-attachment-purpose': 'voice', 'x-voice-waveform': '3,9,31,40,12' });
    expect(up.status).toBe(201);
    expect(up.body).toMatchObject({ kind: 'voice', mimeType: 'audio/mp4', durationMs: 4200, waveform: [3, 9, 31, 31, 12] });
    await send(visitor, conversationId, up.body.id);

    const mine = (await owner.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` })).body.items;
    expect(mine[0]?.attachment).toMatchObject({ kind: 'voice', durationMs: 4200 });
    const file = await h.app.inject({ method: 'GET', url: `/v1/attachments/${up.body.id}`, headers: owner.headers });
    expect(file.rawPayload.includes(Buffer.from('+12.97+077.59/'))).toBe(false);
    const inbox = (await owner.request<InboxDto>({ method: 'GET', url: '/v1/conversations' })).body.items;
    expect(inbox[0]?.lastMessage?.attachment?.kind).toBe('voice');
  });

  it('refuses a "voice message" that is not an audio recording', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const up = await upload(visitor, conversationId, Buffer.from('%PDF-1.7'), { 'x-attachment-purpose': 'voice' });
    expect(up.body.error?.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  it('sends a KLIPY GIF as a link, only from KLIPY\'s media hosts, and drops it when deleted', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const gif = { provider: 'klipy', slug: 'hello-hi-662', url: 'https://static.klipy.com/ii/abc/14/af/eUbp2uNc.webp', width: 498, height: 498 };
    const sent = await visitor.request<MessageDto>({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { clientMessageId: clientId(), gif },
    });
    expect(sent.status).toBe(201);
    expect(sent.body.gif).toEqual(gif);
    const mine = (await owner.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` })).body.items;
    expect(mine[0]?.gif).toEqual(gif);

    const evil = await visitor.request<{ error: { code: string } }>({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { clientMessageId: clientId(), gif: { ...gif, url: 'https://evil.example/track.gif' } },
    });
    expect(evil.body.error.code).toBe('VALIDATION_FAILED');

    await visitor.request({ method: 'DELETE', url: `/v1/messages/${sent.body.id}?scope=everyone` });
    const after = (await owner.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${conversationId}/messages` })).body.items;
    expect(after.find((m) => m.id === sent.body.id)).toMatchObject({ deleted: true, gif: null });
  });
});
