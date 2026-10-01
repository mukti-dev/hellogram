import type { AuthService, PersonaService } from '@hellogram/application';
import type { Actor } from '@hellogram/domain';
import type { LocalEventPublisher } from '@hellogram/infrastructure';
import { ErrorCode } from '@hellogram/shared';
import { createAdapter } from '@socket.io/redis-adapter';
import type { FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { Server, type Namespace, type Socket } from 'socket.io';
import { registerRealtimeEvents } from './events.js';
import { accountRoom, personaRoom, sessionRoom } from './rooms.js';

/** Sockets re-check their session this often, so bans from the admin process apply quickly. */
const SESSION_RECHECK_MS = 60_000;

export interface RealtimeDeps {
  corsOrigins: string[];
  redis: Redis;
  authService: AuthService;
  personaService: PersonaService;
  events: LocalEventPublisher;
  avatarUrl?: (key: string | null) => string | null;
  /** Extra per-socket handlers (chat, calls) registered by later modules. */
  onConnection?: ((socket: Socket, actor: Actor, rt: Namespace) => void)[];
}

export interface SocketData {
  actor: Actor;
}

/**
 * Socket.IO gateway on namespace `/rt` (docs/ARCHITECTURE.md §8).
 * Redis adapter → any API instance can emit to any user. Handlers stay thin and
 * call application services; room names are server-internal only.
 */
export function attachRealtime(app: FastifyInstance, deps: RealtimeDeps): Namespace {
  const io = new Server(app.server, {
    path: '/socket.io',
    transports: ['websocket'],
    cors: { origin: deps.corsOrigins, credentials: true },
    serveClient: false,
  });

  const pub = deps.redis.duplicate({ connectionName: 'hellogram-io-pub' });
  const sub = deps.redis.duplicate({ connectionName: 'hellogram-io-sub' });
  io.adapter(createAdapter(pub, sub, { key: 'hg:io' }));

  const rt = io.of('/rt');

  rt.use(async (socket, next) => {
    const token: unknown = socket.handshake.auth?.token;
    const actor = typeof token === 'string' ? await deps.authService.authenticate(token) : null;
    if (!actor) {
      const error = new Error('Authentication required') as Error & { data?: unknown };
      error.data = { code: ErrorCode.UNAUTHENTICATED };
      return next(error);
    }
    (socket.data as SocketData).actor = actor;
    next();
  });

  rt.on('connection', async (socket) => {
    const { actor } = socket.data as SocketData;
    await socket.join([accountRoom(actor.accountId), sessionRoom(actor.sessionId)]);
    const recheck = setInterval(async () => {
      if (!(await deps.authService.isSessionActive(actor.sessionId).catch(() => true))) socket.disconnect(true);
    }, SESSION_RECHECK_MS);
    socket.on('disconnect', () => clearInterval(recheck));
    const { items } = await deps.personaService.list(actor);
    await socket.join(items.map((p) => personaRoom(p.id)));
    for (const handler of deps.onConnection ?? []) handler(socket, actor, rt);
  });

  registerRealtimeEvents(rt, deps.events, deps.avatarUrl);
  // Logout / remote logout / token reuse / account deletion end live sockets at once.
  deps.events.subscribe('session.revoked', (event) => {
    rt.in(sessionRoom((event.payload as { sessionId: string }).sessionId)).disconnectSockets(true);
  });
  deps.events.subscribe('account.deleted', (event) => {
    rt.in(accountRoom((event.payload as { accountId: string }).accountId)).disconnectSockets(true);
  });

  app.addHook('onClose', async () => {
    await new Promise<void>((resolve) => io.close(() => resolve()));
    await Promise.allSettled([pub.quit(), sub.quit()]);
  });

  return rt;
}
