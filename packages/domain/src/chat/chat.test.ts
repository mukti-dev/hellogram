import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import {
  assertCanDeleteForEveryone,
  assertCanReplyTo,
  messageStatus,
  normalizeChatRetention,
  normalizeMessageBody,
  normalizeNickname,
  retentionMs,
  toReplyPreview,
  type Message,
  type ReplyRef,
} from './chat.js';

const NOW = new Date('2026-09-28T10:00:00Z');
const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm',
  conversationId: 'c',
  senderPersonaId: 'me',
  clientMessageId: 'x',
  type: 'text',
  body: 'hi',
  attachment: null,
  gif: null,
  systemPayload: null,
  suppressed: false,
  createdAt: NOW,
  deliveredAt: null,
  readAt: null,
  deletedForEveryoneAt: null,
  expiredAt: null,
  contentPurgedAt: null,
  replyTo: null,
  ...over,
});

describe('messages (rules 17, 19)', () => {
  it('trims, rejects empty, caps at 4,000 characters', () => {
    expect(normalizeMessageBody('  hello \r\n there ')).toBe('hello \n there');
    expect(() => normalizeMessageBody('   ')).toThrow(DomainError);
    expect(normalizeMessageBody('x'.repeat(4000))).toHaveLength(4000);
    expect(() => normalizeMessageBody('x'.repeat(4001))).toThrowError(/4,000/);
  });

  it('ticks: sent → delivered → read', () => {
    expect(messageStatus(msg())).toBe('sent');
    expect(messageStatus(msg({ deliveredAt: NOW }))).toBe('delivered');
    expect(messageStatus(msg({ deliveredAt: NOW, readAt: NOW }))).toBe('read');
  });

  it('delete for everyone: any chat message, but not system notices', () => {
    expect(() => assertCanDeleteForEveryone(msg())).not.toThrow();
    expect(() => assertCanDeleteForEveryone(msg({ type: 'system', body: null }))).toThrow(DomainError);
  });
});

describe('chat nicknames', () => {
  it('cleans control characters, keeps emoji, caps at 40, null clears', () => {
    expect(normalizeNickname(' Laptop\u0007 buyer 💻 ')).toBe('Laptop buyer 💻');
    expect(normalizeNickname('   ')).toBeNull();
    expect(normalizeNickname(null)).toBeNull();
    expect(() => normalizeNickname('x'.repeat(41))).toThrow(DomainError);
  });
});

describe('chat history (rules 21–22, custom time)', () => {
  it('presets keep their fixed time; custom uses the chat’s own minutes', () => {
    expect(retentionMs('forever', null)).toBeNull();
    expect(retentionMs('h24', null)).toBe(24 * 60 * 60 * 1000);
    expect(retentionMs('d7', 999)).toBe(7 * 24 * 60 * 60 * 1000);
    expect(retentionMs('custom', 5)).toBe(5 * 60 * 1000);
    expect(retentionMs('custom', 150)).toBe(150 * 60 * 1000);
  });

  it('custom must be 5 minutes … 30 days; presets drop the minutes', () => {
    expect(normalizeChatRetention('d30', 90)).toEqual({ retention: 'd30', minutes: null });
    expect(normalizeChatRetention('custom', 5)).toEqual({ retention: 'custom', minutes: 5 });
    expect(normalizeChatRetention('custom', 30 * 24 * 60)).toEqual({ retention: 'custom', minutes: 43_200 });
    for (const bad of [undefined, null, 4, 0, 30 * 24 * 60 + 1, 7.5]) {
      expect(() => normalizeChatRetention('custom', bad)).toThrow(DomainError);
    }
  });
});

describe('replies', () => {
  it('only to a message of the same chat that still has its content, never a system notice', () => {
    expect(() => assertCanReplyTo(msg(), 'c')).not.toThrow();
    const code = (fn: () => void) => {
      try {
        fn();
      } catch (e) {
        return (e as DomainError).code;
      }
      return null;
    };
    expect(code(() => assertCanReplyTo(null, 'c'))).toBe('REPLY_NOT_AVAILABLE');
    expect(code(() => assertCanReplyTo(msg(), 'other'))).toBe('REPLY_NOT_AVAILABLE');
    expect(code(() => assertCanReplyTo(msg({ type: 'system' }), 'c'))).toBe('REPLY_NOT_AVAILABLE');
    expect(code(() => assertCanReplyTo(msg({ deletedForEveryoneAt: NOW }), 'c'))).toBe('REPLY_NOT_AVAILABLE');
    expect(code(() => assertCanReplyTo(msg({ expiredAt: NOW }), 'c'))).toBe('REPLY_NOT_AVAILABLE');
    expect(code(() => assertCanReplyTo(msg({ contentPurgedAt: NOW }), 'c'))).toBe('REPLY_NOT_AVAILABLE');
  });

  const ref = (over: Partial<ReplyRef> = {}): ReplyRef => ({
    id: '0190a5e0-0000-7000-8000-000000000001',
    senderPersonaId: 'them',
    type: 'text',
    body: 'Is it still available?',
    attachment: null,
    hasGif: false,
    suppressed: false,
    deletedForEveryoneAt: null,
    expiredAt: null,
    contentPurgedAt: null,
    ...over,
  });

  it('quotes the text, cut to 200 characters, with `mine` from the viewer’s side', () => {
    expect(toReplyPreview(ref(), 'me')).toEqual({ id: ref().id, mine: false, kind: 'text', text: 'Is it still available?', available: true });
    expect(toReplyPreview(ref(), 'them').mine).toBe(true);
    const long = toReplyPreview(ref({ body: 'x'.repeat(500) }), 'me').text!;
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
  });

  it('kind comes from the attachment or GIF; files without a caption quote their name', () => {
    const file = { kind: 'file' as const, fileName: 'invoice.pdf' };
    expect(toReplyPreview(ref({ body: null, attachment: file }), 'me')).toMatchObject({ kind: 'file', text: 'invoice.pdf' });
    expect(toReplyPreview(ref({ body: 'See this', attachment: file }), 'me')).toMatchObject({ kind: 'file', text: 'See this' });
    expect(toReplyPreview(ref({ body: null, attachment: { kind: 'image', fileName: 'p.jpg' } }), 'me')).toMatchObject({ kind: 'image', text: null });
    expect(toReplyPreview(ref({ body: null, attachment: { kind: 'voice', fileName: 'v.m4a' } }), 'me')).toMatchObject({ kind: 'voice', text: null });
    expect(toReplyPreview(ref({ body: null, attachment: { kind: 'sticker', fileName: 's.webp' } }), 'me')).toMatchObject({ kind: 'sticker' });
    expect(toReplyPreview(ref({ body: null, hasGif: true }), 'me')).toMatchObject({ kind: 'gif', text: null });
  });

  it('deleted, expired or erased originals are "not available", with no text', () => {
    for (const over of [{ deletedForEveryoneAt: NOW }, { expiredAt: NOW }, { contentPurgedAt: NOW, body: null }]) {
      expect(toReplyPreview(ref(over), 'me')).toMatchObject({ available: false, text: null, kind: 'text' });
    }
  });

  it('a suppressed original (sender blocked) is never quoted to the other side', () => {
    expect(toReplyPreview(ref({ suppressed: true }), 'me')).toMatchObject({ available: false, text: null });
    expect(toReplyPreview(ref({ suppressed: true }), 'them')).toMatchObject({ available: true });
  });
});
