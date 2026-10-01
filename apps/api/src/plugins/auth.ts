import type { AuthService, PinService } from '@hellogram/application';
import type { Actor } from '@hellogram/domain';
import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

declare module 'fastify' {
  interface FastifyRequest {
    actor: Actor | null;
    /** Persona ids this device has unlocked with a valid X-Persona-Unlock token (Phase 7). */
    unlocked: Set<string> | null;
  }
  interface FastifyInstance {
    /** preHandler: rejects the request unless it carries a valid access token. */
    requireAuth: (request: FastifyRequest) => Promise<void>;
    /** preHandler: Cloudflare Turnstile check (no-op when not configured). */
    requireHuman: (request: FastifyRequest) => Promise<void>;
  }
}

/** The authenticated actor, for use in controllers behind `requireAuth`. */
export function actorOf(request: FastifyRequest): Actor {
  if (!request.actor) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in');
  return request.actor;
}

export function unlockedOf(request: FastifyRequest): ReadonlySet<string> {
  return request.unlocked ?? new Set();
}

export const authPlugin = fp<{ authService: AuthService; pinService?: PinService }>(async (app: FastifyInstance, { authService, pinService }) => {
  app.decorateRequest('actor', null);
  app.decorateRequest('unlocked', null);

  app.decorate('requireAuth', async (request: FastifyRequest) => {
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    const actor = token ? await authService.authenticate(token) : null;
    if (!actor) throw new DomainError(ErrorCode.UNAUTHENTICATED, 'Please log in');

    // Rule 25: locked numbers are readable only with this device's unlock token(s).
    const unlockHeader = request.headers['x-persona-unlock'];
    const tokens = (Array.isArray(unlockHeader) ? unlockHeader.join(',') : (unlockHeader ?? ''))
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    const unlocked = pinService && tokens.length ? await pinService.resolveUnlocked(actor.sessionId, tokens) : new Set<string>();
    request.unlocked = unlocked;
    request.actor = { ...actor, unlockedPersonaIds: unlocked };
  });
});
