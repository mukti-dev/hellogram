import type { RequestService } from '@hellogram/application';
import type { ContactRequest } from '@hellogram/domain';
import type { IncomingRequestDto, SendRequestBody, SentRequestDto } from '@hellogram/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../plugins/auth.js';
import { toCounterpart, toOwnBrief, type AvatarUrl } from '../shared-mappers.js';

type IdParams = { Params: { id: string } };

export class RequestController {
  constructor(
    private readonly requests: RequestService,
    private readonly avatarUrl: AvatarUrl,
  ) {}

  private incomingDto = (r: ContactRequest): IncomingRequestDto => ({
    id: r.id,
    from: toCounterpart(r.fromPersona, this.avatarUrl),
    to: toOwnBrief(r.toPersona),
    introMessage: r.introMessage,
    status: r.status === 'blocked' ? 'blocked' : 'pending',
    createdAt: r.createdAt.toISOString(),
  });

  private sentDto = (r: ContactRequest): SentRequestDto => ({
    id: r.id,
    from: toOwnBrief(r.fromPersona),
    to: toCounterpart(r.toPersona, this.avatarUrl),
    introMessage: r.introMessage,
    // Rule 15: never reveal a block to the sender — it looks pending, then expires on schedule.
    status: r.status === 'blocked' ? (r.expiresAt <= new Date() ? 'expired' : 'pending') : r.status,
    createdAt: r.createdAt.toISOString(),
  });

  listIncoming = async (
    request: FastifyRequest<{ Querystring: { status?: 'pending' | 'blocked'; personaId?: string; cursor?: string } }>,
  ) => {
    const { status = 'pending', personaId, cursor } = request.query;
    const page = await this.requests.listIncoming(actorOf(request), { status, personaId, cursor });
    return { items: page.items.map(this.incomingDto), nextCursor: page.nextCursor };
  };

  listSent = async (request: FastifyRequest<{ Querystring: { cursor?: string } }>) => {
    const page = await this.requests.listSent(actorOf(request), request.query.cursor);
    return { items: page.items.map(this.sentDto), nextCursor: page.nextCursor };
  };

  pendingCount = async (request: FastifyRequest) => ({ count: await this.requests.pendingCount(actorOf(request)) });

  send = async (request: FastifyRequest<{ Body: SendRequestBody }>, reply: FastifyReply) => {
    const created = await this.requests.send(actorOf(request), request.body);
    return reply.status(201).send(this.sentDto(created));
  };

  accept = async (request: FastifyRequest<IdParams>) => this.requests.accept(actorOf(request), request.params.id);

  decline = async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
    await this.requests.decline(actorOf(request), request.params.id);
    return reply.status(204).send();
  };

  block = async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
    await this.requests.block(actorOf(request), request.params.id);
    return reply.status(204).send();
  };
}
