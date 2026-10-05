import { InMemoryBlobStore } from '@hellogram/infrastructure';
import type { AttachmentDto, InboxDto, MessageDto, MessagePageDto } from '@hellogram/shared';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { clientId, connectedPair } from './fixtures.js';
import { assertNoAccountLeak, createHarness, type Harness, type User } from './harness.js';

let h: Harness;
const storage = new InMemoryBlobStore();
beforeAll(async () => {
  h = await createHarness({}, { blobs: storage });
});
afterAll(async () => h.close());
beforeEach(async () => {
  await h.reset();
  storage.objects.clear();
});

// A real 1×1 PNG.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
const PDF = Buffer.from('%PDF-1.7\nTOP-SECRET-RENT-AGREEMENT\n%%EOF');

const upload = (user: User, conversationId: string, file: Buffer, name: string) =>
  h.app
    .inject({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/attachments`,
      headers: { ...user.headers, 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name) },
      payload: file,
    })
    .then((r) => ({ status: r.statusCode, body: r.json() as AttachmentDto & { error?: { code: string } } }));

const download = (user: User | null, id: string, headers: Record<string, string> = {}) =>
  h.app.inject({ method: 'GET', url: `/v1/attachments/${id}`, headers: { ...(user?.headers ?? {}), ...headers } });

const send = (user: User, conversationId: string, attachmentId: string, body?: string) =>
  user.request<MessageDto & { error?: { code: string } }>({
    method: 'POST',
    url: `/v1/conversations/${conversationId}/messages`,
    payload: { clientMessageId: clientId(), attachmentId, ...(body ? { body } : {}) },
  });

const messages = async (u: User, id: string) =>
  (await u.request<MessagePageDto>({ method: 'GET', url: `/v1/conversations/${id}/messages` })).body.items;

/** Uploads and sends a file from `from`; returns the attachment and the message. */
async function share(from: User, conversationId: string, file = PDF, name = 'agreement.pdf') {
  const up = await upload(from, conversationId, file, name);
  expect(up.status).toBe(201);
  const sent = await send(from, conversationId, up.body.id);
  expect(sent.status).toBe(201);
  return { attachment: up.body, message: sent.body };
}

describe('sharing a file', () => {
  it('is stored encrypted under a random name and reaches only the other member', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { attachment, message } = await share(visitor, conversationId);

    expect(attachment).toEqual({
      id: attachment.id,
      kind: 'file',
      fileName: 'agreement.pdf',
      mimeType: 'application/pdf',
      size: PDF.length,
      width: null,
      height: null,
      durationMs: null,
      waveform: null,
    });
    expect(message.attachment).toEqual(attachment);
    expect(message.body).toBeNull();
    assertNoAccountLeak(message);
    expect(JSON.stringify(message)).not.toContain('storageKey');

    // What sits in storage: one object, random key, no readable content or names.
    expect(storage.objects.size).toBe(1);
    const [[key, sealed]] = [...storage.objects.entries()] as [[string, Uint8Array]];
    expect(key).toMatch(/^att\/[A-Za-z0-9_-]{32}$/);
    for (const text of ['TOP-SECRET', '%PDF', 'agreement', conversationId, attachment.id]) {
      expect(Buffer.from(sealed).includes(Buffer.from(text))).toBe(false);
      expect(key).not.toContain(text);
    }

    // The other member sees it in the chat and can fetch the original bytes.
    expect((await messages(owner, conversationId))[0]!.attachment).toEqual(attachment);
    const got = await download(owner, attachment.id);
    expect(got.statusCode).toBe(200);
    expect(got.rawPayload.equals(PDF)).toBe(true);
    const inbox = await owner.request<InboxDto>({ method: 'GET', url: '/v1/conversations' });
    expect(inbox.body.items[0]!.lastMessage!.attachment!.fileName).toBe('agreement.pdf');
  });

  it('serves files with headers that stop caching, sniffing and script execution', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const pdf = await share(visitor, conversationId);
    const image = await share(visitor, conversationId, PNG, 'photo.png');

    const file = await download(owner, pdf.attachment.id);
    expect(file.headers['content-type']).toBe('application/octet-stream');
    expect(file.headers['content-disposition']).toContain('attachment; filename="agreement.pdf"');
    expect(file.headers['cache-control']).toBe('private, no-store');
    expect(file.headers['x-content-type-options']).toBe('nosniff');
    expect(file.headers['content-security-policy']).toBe("default-src 'none'; sandbox");
    expect(file.headers['cross-origin-resource-policy']).toBe('same-origin');

    const img = await download(owner, image.attachment.id);
    expect(img.headers['content-type']).toBe('image/png');
    expect(img.headers['content-disposition']).toContain('inline');
    expect(image.attachment).toMatchObject({ kind: 'image', width: 1, height: 1 });
  });

  it('can carry a caption', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const up = await upload(visitor, conversationId, PNG, 'bike.png');
    const sent = await send(visitor, conversationId, up.body.id, '  Here is the bike  ');
    expect(sent.body).toMatchObject({ body: 'Here is the bike', attachment: { kind: 'image' } });
    expect((await messages(owner, conversationId))[0]).toMatchObject({ body: 'Here is the bike', mine: false });
  });

  it('removes location data from photos before storing them', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const seg = (marker: number, data: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (data.length + 2) >> 8, (data.length + 2) & 0xff]), data]);
    const jpeg = Buffer.concat([
      Buffer.from([0xff, 0xd8]),
      seg(0xe1, Buffer.from('Exif\0\0GPS-12.9716N-77.5946E')),
      seg(0xc0, Buffer.from([8, 0, 4, 0, 6, 1, 1, 0x11, 0])),
      seg(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
      Buffer.from('scan'),
      Buffer.from([0xff, 0xd9]),
    ]);
    const { attachment } = await share(visitor, conversationId, jpeg, 'IMG_2041.JPG');
    expect(attachment).toMatchObject({ kind: 'image', mimeType: 'image/jpeg', width: 6, height: 4 });
    const got = (await download(owner, attachment.id)).rawPayload;
    expect(got.includes(Buffer.from('GPS'))).toBe(false);
    expect(got.includes(Buffer.from('scan'))).toBe(true);
  });
});

describe('who can download', () => {
  it('needs a login, and says "not found" to anyone outside the chat', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { attachment } = await share(visitor, conversationId);
    const stranger = await h.signUp();

    expect((await download(null, attachment.id)).statusCode).toBe(401);
    const res = await download(stranger, attachment.id);
    expect(res.statusCode).toBe(404);
    expect(res.rawPayload.includes(Buffer.from('TOP-SECRET'))).toBe(false);
    // Same answer as an id that never existed: the endpoint can't be used to find files.
    const missing = await download(stranger, '3f0c0e4e-8a53-4c5e-9d0b-1f2a3b4c5d6e');
    expect(missing.statusCode).toBe(404);
    expect(missing.json()).toEqual(res.json());
    expect((await download(owner, attachment.id)).statusCode).toBe(200);
  });

  it('keeps an upload private until it is actually sent', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const up = await upload(visitor, conversationId, PDF, 'draft.pdf');
    expect((await download(owner, up.body.id)).statusCode).toBe(404);
    expect((await download(visitor, up.body.id)).statusCode).toBe(404);
  });

  it('only lets the uploader send their own upload, once, in the chat it was uploaded to', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const other = await connectedPair(h);
    const up = await upload(visitor, conversationId, PDF, 'mine.pdf');

    // Someone else in the same chat, and a member of a different chat.
    expect((await send(owner, conversationId, up.body.id)).status).toBe(400);
    expect((await send(other.visitor, other.conversationId, up.body.id)).status).toBe(400);
    expect(await messages(owner, conversationId)).toHaveLength(1); // nothing was created (intro only)

    expect((await send(visitor, conversationId, up.body.id)).status).toBe(201);
    expect((await send(visitor, conversationId, up.body.id)).status).toBe(400);
  });

  it('non-members cannot upload into a chat', async () => {
    const { conversationId } = await connectedPair(h);
    const stranger = await h.signUp();
    expect((await upload(stranger, conversationId, PDF, 'spam.pdf')).status).toBe(404);
    expect(storage.objects.size).toBe(0);
  });

  it('a blocked sender’s file never reaches the blocker', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/block` });
    const { attachment, message } = await share(visitor, conversationId);
    expect(message.status).toBe('sent'); // looks normal to the sender
    expect((await download(visitor, attachment.id)).statusCode).toBe(200);
    expect((await download(owner, attachment.id)).statusCode).toBe(404);
  });

  it('respects the PIN lock on a number', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);
    const { attachment } = await share(visitor, conversationId);
    await owner.request({ method: 'PUT', url: `/v1/personas/${ownerNumber.id}/pin`, payload: { pin: '4826' } });

    const locked = await download(owner, attachment.id);
    expect(locked.statusCode).toBe(403);
    expect(locked.json().error.code).toBe('PERSONA_LOCKED');

    const unlock = await owner.request<{ unlockToken: string }>({ method: 'POST', url: `/v1/personas/${ownerNumber.id}/unlock`, payload: { pin: '4826' } });
    expect((await download(owner, attachment.id, { 'x-persona-unlock': unlock.body.unlockToken })).statusCode).toBe(200);
  });
});

describe('deleting and expiry', () => {
  it('delete for everyone hides the file at once and destroys it 30 days later', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { attachment, message } = await share(visitor, conversationId);
    expect(storage.objects.size).toBe(1);

    expect((await visitor.request({ method: 'DELETE', url: `/v1/messages/${message.id}?scope=everyone` })).status).toBe(204);
    expect((await download(owner, attachment.id)).statusCode).toBe(404);
    expect((await download(visitor, attachment.id)).statusCode).toBe(404);
    expect((await messages(owner, conversationId))[0]).toMatchObject({ deleted: true, attachment: null });
    // Soft delete: kept (unreadable) for 30 days.
    expect(await h.container.maintenanceService.eraseDeletedContent()).toBe(0);
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(0);
    expect(storage.objects.size).toBe(1);

    await h.db.query(`UPDATE messages SET "deletedForEveryoneAt" = now() - interval '31 days' WHERE id = $1`, [message.id]);
    expect(await h.container.maintenanceService.eraseDeletedContent()).toBe(1);
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(1);
    expect(storage.objects.size).toBe(0);
  });

  it('delete for me and clear chat hide the file for that side only', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const first = await share(visitor, conversationId);
    await owner.request({ method: 'DELETE', url: `/v1/messages/${first.message.id}?scope=me` });
    expect((await download(owner, first.attachment.id)).statusCode).toBe(404);
    expect((await download(visitor, first.attachment.id)).statusCode).toBe(200);

    const second = await share(visitor, conversationId);
    await owner.request({ method: 'POST', url: `/v1/conversations/${conversationId}/clear` });
    expect((await download(owner, second.attachment.id)).statusCode).toBe(404);
    expect((await download(visitor, second.attachment.id)).statusCode).toBe(200);
  });

  it('disappearing messages take their files with them', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { attachment, message } = await share(visitor, conversationId);
    await owner.request({ method: 'PATCH', url: `/v1/conversations/${conversationId}`, payload: { retention: 'h24' } });
    await h.db.query(`UPDATE messages SET "createdAt" = now() - interval '25 hours' WHERE id = $1`, [message.id]);

    await h.container.maintenanceService.expireContent();
    // Unreadable at once, but kept for 30 days…
    expect((await download(owner, attachment.id)).statusCode).toBe(404);
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(0);
    expect(storage.objects.size).toBe(1);
    // …then erased and destroyed.
    await h.db.query(`UPDATE messages SET "expiredAt" = now() - interval '31 days' WHERE id = $1`, [message.id]);
    expect(await h.container.maintenanceService.eraseDeletedContent()).toBe(1);
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(1);
    expect(storage.objects.size).toBe(0);
    expect((await h.db.query('SELECT 1 FROM attachments')).rowCount).toBe(0);
  });

  it('uploads that are never sent are destroyed after an hour', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const kept = await share(visitor, conversationId);
    const abandoned = await upload(visitor, conversationId, PDF, 'never-sent.pdf');
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(0);

    await h.db.query(`UPDATE attachments SET "createdAt" = now() - interval '2 hours'`);
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(1);
    expect(storage.objects.size).toBe(1);
    expect((await send(visitor, conversationId, abandoned.body.id)).status).toBe(400);
    expect((await download(visitor, kept.attachment.id)).statusCode).toBe(200);
  });

  it('files of hard-deleted messages are destroyed too', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const { message } = await share(visitor, conversationId);
    await h.db.query(`UPDATE attachments SET "createdAt" = now() - interval '2 hours'`);
    await h.db.query('DELETE FROM messages WHERE id = $1', [message.id]);
    expect(await h.container.maintenanceService.sweepAttachments()).toBe(1);
    expect(storage.objects.size).toBe(0);
  });
});

describe('what can be uploaded', () => {
  it('refuses web pages, scripts and programs, whatever they are called', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const cases: [string, Buffer][] = [
      ['page.html', Buffer.from('<html><script>alert(1)</script></html>')],
      ['photo.jpg', Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>')],
      ['setup.exe', Buffer.from('MZ\x90\0\x03')],
      ['app.apk', Buffer.from([0x50, 0x4b, 0x03, 0x04, 1, 2, 3])],
    ];
    for (const [name, file] of cases) {
      const res = await upload(visitor, conversationId, file, name);
      expect(res.status).toBe(415);
      expect(res.body.error?.code).toBe('FILE_TYPE_NOT_ALLOWED');
    }
    expect(storage.objects.size).toBe(0);
  });

  it('refuses files over 10 MB', async () => {
    const { visitor, conversationId } = await connectedPair(h);
    const big = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(10 * 1024 * 1024)]);
    const res = await upload(visitor, conversationId, big, 'big.pdf');
    expect(res.status).toBe(413);
    expect(res.body.error?.code).toBe('FILE_TOO_LARGE');
  });

  it('a tampered object in storage is never served', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const { attachment } = await share(visitor, conversationId);
    const [[key, sealed]] = [...storage.objects.entries()] as [[string, Uint8Array]];
    const copy = Buffer.from(sealed);
    copy[copy.length - 20] = (copy[copy.length - 20] ?? 0) ^ 0xff;
    storage.objects.set(key, copy);
    const res = await download(owner, attachment.id);
    expect(res.statusCode).toBe(500);
    expect(res.rawPayload.includes(Buffer.from('TOP-SECRET'))).toBe(false);
  });
});

describe('media sharing switch', () => {
  it('a chat allows files only when both numbers allow them', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);
    const chat = async (u: User) => (await u.request<{ mediaAllowed: boolean }>({ method: 'GET', url: `/v1/conversations/${conversationId}` })).body;
    expect((await chat(visitor)).mediaAllowed).toBe(true);
    const ready = await upload(visitor, conversationId, PDF, 'early.pdf');

    // The owner turns media off on their number: neither side can share files in that chat.
    await owner.request({ method: 'PATCH', url: `/v1/personas/${ownerNumber.id}`, payload: { allowMedia: false } });
    expect((await chat(visitor)).mediaAllowed).toBe(false);
    expect((await chat(owner)).mediaAllowed).toBe(false);
    const refused = await upload(visitor, conversationId, PDF, 'blocked.pdf');
    expect(refused.status).toBe(403);
    expect(refused.body.error?.code).toBe('MEDIA_NOT_ALLOWED');
    expect((await upload(owner, conversationId, PNG, 'mine.png')).status).toBe(403);
    // An upload made before the switch can't be sent afterwards either.
    const late = await send(visitor, conversationId, ready.body.id);
    expect(late.status).toBe(403);

    // Text still works.
    const text = await visitor.request({ method: 'POST', url: `/v1/conversations/${conversationId}/messages`, payload: { clientMessageId: clientId(), body: 'ok' } });
    expect(text.status).toBe(201);
  });
});
