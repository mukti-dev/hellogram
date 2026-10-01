import { describe, expect, it } from 'vitest';
import { DomainError } from '../errors/domain-error.js';
import { assertCanDeleteForEveryone, messageStatus, normalizeMessageBody, normalizeNickname, type Message } from './chat.js';

const NOW = new Date('2026-09-28T10:00:00Z');
const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm',
  conversationId: 'c',
  senderPersonaId: 'me',
  clientMessageId: 'x',
  type: 'text',
  body: 'hi',
  attachment: null,
  systemPayload: null,
  suppressed: false,
  createdAt: NOW,
  deliveredAt: null,
  readAt: null,
  deletedForEveryoneAt: null,
  contentPurgedAt: null,
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
