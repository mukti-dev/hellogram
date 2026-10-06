import type { MessageDto } from '@hellogram/shared';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { chatSocketHandlers } from '../../src/realtime/chat-handlers.js';
import { attachRealtime } from '../../src/realtime/gateway.js';
import { clientId, connectedPair, sendMessage } from './fixtures.js';
import { createHarness, type Harness } from './harness.js';

let h: Harness;
let url: string;
const sockets: Socket[] = [];

beforeAll(async () => {
  h = await createHarness();
  attachRealtime(h.app, {
    corsOrigins: [],
    redis: h.container.redis!,
    authService: h.container.authService,
    personaService: h.container.personaService,
    events: h.container.events,
    onConnection: [chatSocketHandlers(h.container.chatService)],
  });
  await h.app.listen({ port: 0, host: '127.0.0.1' });
  const address = h.app.server.address();
  url = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}`;
});
afterAll(async () => {
  for (const s of sockets) s.disconnect();
  await h.close();
});
beforeEach(async () => h.reset());

function connect(token: string): Promise<Socket> {
  const socket = io(`${url}/rt`, { path: '/socket.io', transports: ['websocket'], auth: { token }, forceNew: true });
  sockets.push(socket);
  return new Promise((resolve, reject) => {
    socket.on('connect', () => setTimeout(() => resolve(socket), 100)); // allow room joins
    socket.on('connect_error', reject);
  });
}

const next = <T>(socket: Socket, event: string, ms = 3000) =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timeout waiting for ${event}`)), ms);
    socket.once(event, (payload: T) => {
      clearTimeout(timer);
      resolve(payload);
    });
  });

describe('realtime chat', () => {
  it('rejects sockets without a valid token', async () => {
    await expect(connect('not-a-token')).rejects.toThrow();
  });

  it('delivers messages live, then ticks flow back to the sender', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const ownerSocket = await connect(owner.token);
    const visitorSocket = await connect(visitor.token);

    const incoming = next<{ message: MessageDto }>(ownerSocket, 'message:new');
    const sent = await sendMessage(visitor, conversationId, 'Live hello');
    const { message } = await incoming;
    expect(message).toMatchObject({ body: 'Live hello', mine: false, clientMessageId: null, status: null });

    const delivered = next<{ messageIds: string[] }>(visitorSocket, 'message:delivered');
    ownerSocket.emit('message:ack', { messageIds: [message.id] });
    expect((await delivered).messageIds).toEqual([sent.body.id]);

    const read = next<{ upToMessageId: string }>(visitorSocket, 'message:read');
    ownerSocket.emit('message:read', { conversationId, upToMessageId: message.id });
    expect((await read).upToMessageId).toBe(message.id);
  });

  it('live replies carry the quote, seen from the recipient’s side', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const original = await sendMessage(owner, conversationId, 'Original question');
    const ownerSocket = await connect(owner.token);
    const incoming = next<{ message: MessageDto }>(ownerSocket, 'message:new');
    await visitor.request({
      method: 'POST',
      url: `/v1/conversations/${conversationId}/messages`,
      payload: { clientMessageId: clientId(), body: 'An answer', replyToId: original.body.id },
    });
    const { message } = await incoming;
    expect(message.replyTo).toEqual({ id: original.body.id, mine: true, kind: 'text', text: 'Original question', available: true });
  });

  it('a locked number gets content-free notifications (rule 27)', async () => {
    const { owner, visitor, ownerNumber, conversationId } = await connectedPair(h);
    await owner.request({ method: 'PUT', url: `/v1/personas/${ownerNumber.id}/pin`, payload: { pin: '4826' } });
    const ownerSocket = await connect(owner.token);
    const incoming = next<Record<string, unknown>>(ownerSocket, 'message:new');
    await sendMessage(visitor, conversationId, 'secret preview');
    const payload = await incoming;
    expect(payload).toEqual({ locked: true, personaId: ownerNumber.id });
    expect(JSON.stringify(payload)).not.toContain('secret');
  });

  it('logging out ends that device’s live socket', async () => {
    const { owner } = await connectedPair(h);
    const socket = await connect(owner.token);
    const closed = new Promise<string>((resolve) => socket.once('disconnect', (reason) => resolve(reason)));
    await h.app.inject({
      method: 'POST',
      url: '/v1/auth/logout',
      headers: { cookie: `hg_rt=${owner.refresh}`, 'x-hellogram-client': 'web' },
    });
    expect(await closed).toBe('io server disconnect');
  });

  it('typing reaches the other side, throttled to once per 3 seconds', async () => {
    const { owner, visitor, conversationId } = await connectedPair(h);
    const ownerSocket = await connect(owner.token);
    const visitorSocket = await connect(visitor.token);

    let count = 0;
    ownerSocket.on('typing', () => count++);
    visitorSocket.emit('typing', { conversationId });
    visitorSocket.emit('typing', { conversationId });
    visitorSocket.emit('typing', { conversationId });
    await new Promise((r) => setTimeout(r, 400));
    expect(count).toBe(1);
  });
});
