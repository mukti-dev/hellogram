import type { AccountService } from '@hellogram/application';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { actorOf } from '../../plugins/auth.js';
import type { confirmEmailBody, sessionParams, startEmailBody } from './me.schemas.js';

export class MeController {
  constructor(private readonly accounts: AccountService) {}

  getMe = async (request: FastifyRequest) => {
    const me = await this.accounts.getMe(actorOf(request));
    return { ...me, createdAt: me.createdAt.toISOString() };
  };

  listSessions = async (request: FastifyRequest) => {
    const sessions = await this.accounts.listSessions(actorOf(request));
    return {
      items: sessions.map((s) => ({
        ...s,
        createdAt: s.createdAt.toISOString(),
        lastSeenAt: s.lastSeenAt.toISOString(),
      })),
    };
  };

  revokeSession = async (request: FastifyRequest<{ Params: z.infer<typeof sessionParams> }>, reply: FastifyReply) => {
    await this.accounts.revokeSession(actorOf(request), request.params.id);
    return reply.status(204).send();
  };

  startEmail = async (request: FastifyRequest<{ Body: z.infer<typeof startEmailBody> }>, reply: FastifyReply) => {
    await this.accounts.startEmailVerification(actorOf(request), request.body.email, request.ip);
    return reply.status(204).send();
  };

  confirmEmail = async (request: FastifyRequest<{ Body: z.infer<typeof confirmEmailBody> }>, reply: FastifyReply) => {
    await this.accounts.confirmEmail(actorOf(request), request.body.email, request.body.code);
    return reply.status(204).send();
  };
}
