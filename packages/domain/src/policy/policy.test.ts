import { describe, expect, it } from 'vitest';
import type { Persona } from '../personas/persona.js';
import { evaluateCall, evaluateMessage, evaluateRequest, isPubliclyVisible, type ReachContext } from './policy.js';

const NOW = new Date('2026-09-28T10:00:00Z');

const persona = (over: Partial<Persona> = {}): Persona => ({
  id: 'p',
  accountId: 'a',
  code: 'A482719K',
  displayName: 'X',
  avatarKey: null,
  labelKind: 'other',
  labelText: null,
  status: 'active',
  pauseReason: null,
  isPaid: false,
  acceptRequests: true,
  allowCalls: true,
  readReceipts: true,
  dndUntil: null,
  defaultRetention: 'd30',
  hasPin: false,
  createdAt: NOW,
  retiredAt: null,
  ...over,
});

const ctx = (over: Partial<ReachContext> = {}): ReachContext => ({
  now: NOW,
  actorAccount: { id: 'A', status: 'active', suspendedUntil: null },
  actorPersona: persona({ id: 'x', accountId: 'A' }),
  targetAccount: { id: 'B', status: 'active', suspendedUntil: null },
  targetPersona: persona({ id: 'y', accountId: 'B' }),
  blocked: false,
  ...over,
});

const facts = { pendingExists: false, declinedWithin7Days: false, sentToday: 0 };
const kind = (d: ReturnType<typeof evaluateRequest>) => (d.kind === 'reject' ? d.code : d.kind);

describe('policy — requests (rules 10, 12, 14)', () => {
  it('allows a normal request', () => expect(kind(evaluateRequest(ctx(), facts))).toBe('allow'));

  it('blocked requests are silently suppressed, never rejected', () => {
    expect(kind(evaluateRequest(ctx({ blocked: true }), facts))).toBe('suppress');
  });

  it('cannot request your own number', () => {
    expect(kind(evaluateRequest(ctx({ targetAccount: { id: 'A', status: 'active', suspendedUntil: null } }), facts))).toBe(
      'OWN_NUMBER',
    );
  });

  it('paused numbers and acceptRequests=false stop new requests (rule 7)', () => {
    expect(kind(evaluateRequest(ctx({ targetPersona: persona({ status: 'paused', pauseReason: 'user' }) }), facts))).toBe(
      'NOT_ACCEPTING_REQUESTS',
    );
    expect(kind(evaluateRequest(ctx({ targetPersona: persona({ acceptRequests: false }) }), facts))).toBe(
      'NOT_ACCEPTING_REQUESTS',
    );
  });

  it('7-day cool-down after decline, one pending per pair, 20 per day', () => {
    expect(kind(evaluateRequest(ctx(), { ...facts, declinedWithin7Days: true }))).toBe('REQUEST_COOLDOWN');
    expect(kind(evaluateRequest(ctx(), { ...facts, pendingExists: true }))).toBe('REQUEST_ALREADY_PENDING');
    expect(kind(evaluateRequest(ctx(), { ...facts, sentToday: 20 }))).toBe('REQUEST_DAILY_CAP');
  });

  it('retired or banned targets are unavailable (rule 35)', () => {
    expect(kind(evaluateRequest(ctx({ targetPersona: persona({ status: 'retired' }) }), facts))).toBe('NUMBER_UNAVAILABLE');
    expect(kind(evaluateRequest(ctx({ targetAccount: { id: 'B', status: 'banned', suspendedUntil: null } }), facts))).toBe(
      'NUMBER_UNAVAILABLE',
    );
  });

  it('restricted actors cannot act', () => {
    const until = new Date(NOW.getTime() + 1000);
    expect(kind(evaluateRequest(ctx({ actorAccount: { id: 'A', status: 'suspended', suspendedUntil: until } }), facts))).toBe(
      'ACCOUNT_RESTRICTED',
    );
    const expired = new Date(NOW.getTime() - 1000);
    expect(kind(evaluateRequest(ctx({ actorAccount: { id: 'A', status: 'suspended', suspendedUntil: expired } }), facts))).toBe(
      'allow',
    );
  });
});

describe('policy — messages (rules 7, 9, 14)', () => {
  const open = { closed: false };
  it('allows messages in open conversations', () => expect(kind(evaluateMessage(ctx(), open))).toBe('allow'));
  it('suppresses messages across a block (either direction)', () =>
    expect(kind(evaluateMessage(ctx({ blocked: true }), open))).toBe('suppress'));
  it('closed conversations say the number is unavailable', () =>
    expect(kind(evaluateMessage(ctx(), { closed: true }))).toBe('NUMBER_UNAVAILABLE'));
  it('user-paused numbers keep chatting (rule 7)', () => {
    expect(kind(evaluateMessage(ctx({ actorPersona: persona({ status: 'paused', pauseReason: 'user' }) }), open))).toBe('allow');
    expect(kind(evaluateMessage(ctx({ targetPersona: persona({ status: 'paused', pauseReason: 'user' }) }), open))).toBe('allow');
  });
  it('billing-paused numbers cannot send or receive (rule 9)', () => {
    expect(kind(evaluateMessage(ctx({ actorPersona: persona({ status: 'paused', pauseReason: 'billing' }) }), open))).toBe(
      'NUMBER_PAUSED',
    );
    expect(kind(evaluateMessage(ctx({ targetPersona: persona({ status: 'paused', pauseReason: 'billing' }) }), open))).toBe(
      'suppress',
    );
  });
});

describe('policy — calls (rules 29, 31)', () => {
  const f = { closed: false, calleeAccountBusy: false };
  it('allows calls when the callee accepts calls', () => expect(kind(evaluateCall(ctx(), f))).toBe('allow'));
  it.each([
    ['calls off', ctx({ targetPersona: persona({ allowCalls: false }) }), f],
    ['DND', ctx({ targetPersona: persona({ dndUntil: new Date(NOW.getTime() + 60_000) }) }), f],
    ['busy', ctx(), { ...f, calleeAccountBusy: true }],
    ['blocked', ctx({ blocked: true }), f],
  ])('%s looks exactly like no answer', (_label, c, facts2) => {
    expect(kind(evaluateCall(c, facts2))).toBe('ring_out');
  });
  it('expired DND no longer blocks calls', () => {
    expect(kind(evaluateCall(ctx({ targetPersona: persona({ dndUntil: new Date(NOW.getTime() - 1) }) }), f))).toBe('allow');
  });
  it('closed conversations reject calls', () => expect(kind(evaluateCall(ctx(), { ...f, closed: true }))).toBe('NUMBER_UNAVAILABLE'));
});

describe('policy — public card', () => {
  const acct = { id: 'B', status: 'active' as const, suspendedUntil: null };
  it('hides retired, banned and missing numbers the same way', () => {
    expect(isPubliclyVisible(persona(), acct, NOW)).toBe(true);
    expect(isPubliclyVisible(persona({ status: 'retired' }), acct, NOW)).toBe(false);
    expect(isPubliclyVisible(persona(), { ...acct, status: 'banned' }, NOW)).toBe(false);
    expect(isPubliclyVisible(null, null, NOW)).toBe(false);
  });
});
