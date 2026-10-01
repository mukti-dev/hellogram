import type { ChatService } from '@hellogram/application';
import type { LabelKind, SendMessageBody, UpdateConversationBody } from '@hellogram/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf } from '../../plugins/auth.js';
import type { AvatarUrl } from '../shared-mappers.js';
import { toConversationDto, toLockedRow, toMessageDto } from './chat.mapper.js';

type IdParams = { Params: { id: string } };

export class ChatController {
  constructor(
    private readonly chat: ChatService,
    private readonly avatarUrl: AvatarUrl,
  ) {}

  inbox = async (
    request: FastifyRequest<{
      Querystring: { personaId?: string; label?: LabelKind; unread?: boolean; q?: string; cursor?: string };
    }>,
  ) => {
    const { personaId, label, unread, q, cursor } = request.query;
    const result = await this.chat.inbox(actorOf(request), { personaId, labelKind: label, unreadOnly: unread, query: q, cursor });
    return {
      items: result.items.map((row) => toConversationDto(row, this.avatarUrl)),
      nextCursor: result.nextCursor,
      locked: result.locked.map(toLockedRow),
    };
  };

  unreadCount = async (request: FastifyRequest) => ({ count: await this.chat.unreadCount(actorOf(request)) });

  get = async (request: FastifyRequest<IdParams>) =>
    toConversationDto(await this.chat.view(actorOf(request), request.params.id), this.avatarUrl);

  messages = async (request: FastifyRequest<IdParams & { Querystring: { cursor?: string } }>) => {
    const actor = actorOf(request);
    const view = await this.chat.view(actor, request.params.id);
    const page = await this.chat.messages(actor, request.params.id, request.query.cursor);
    return { items: page.items.map((m) => toMessageDto(m, view.myPersona.id)), nextCursor: page.nextCursor };
  };

  send = async (request: FastifyRequest<IdParams & { Body: SendMessageBody }>, reply: FastifyReply) => {
    const message = await this.chat.send(actorOf(request), request.params.id, request.body);
    return reply.status(201).send(toMessageDto(message, message.senderPersonaId));
  };

  read = async (request: FastifyRequest<IdParams & { Body: { upToMessageId: string } }>, reply: FastifyReply) => {
    await this.chat.markRead(actorOf(request), request.params.id, request.body.upToMessageId);
    return reply.status(204).send();
  };

  ack = async (request: FastifyRequest<{ Body: { messageIds: string[] } }>, reply: FastifyReply) => {
    await this.chat.ackDelivered(actorOf(request), request.body.messageIds);
    return reply.status(204).send();
  };

  update = async (request: FastifyRequest<IdParams & { Body: UpdateConversationBody }>) => {
    const { mutedUntil, ...rest } = request.body;
    const view = await this.chat.updateSettings(actorOf(request), request.params.id, {
      ...rest,
      ...(mutedUntil === undefined ? {} : { mutedUntil: mutedUntil === null ? null : new Date(mutedUntil) }),
    });
    return toConversationDto(view, this.avatarUrl);
  };

  clear = async (request: FastifyRequest<IdParams>, reply: FastifyReply) => {
    await this.chat.clear(actorOf(request), request.params.id);
    return reply.status(204).send();
  };

  deleteMessage = async (
    request: FastifyRequest<IdParams & { Querystring: { scope: 'me' | 'everyone' } }>,
    reply: FastifyReply,
  ) => {
    await this.chat.deleteMessage(actorOf(request), request.params.id, request.query.scope);
    return reply.status(204).send();
  };
}
