import type { PersonaService } from '@hellogram/application';
import type { CreatePersonaBody, UpdatePersonaBody } from '@hellogram/shared';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { actorOf, unlockedOf } from '../../plugins/auth.js';
import { toOwnPersonaDto } from './persona.mapper.js';

type IdParams = { Params: { id: string } };

export class PersonaController {
  constructor(private readonly personas: PersonaService) {}

  private dto = (request: FastifyRequest) => (p: Parameters<typeof toOwnPersonaDto>[0]) =>
    toOwnPersonaDto(p, (key) => this.personas.avatarUrl(key), unlockedOf(request));

  list = async (request: FastifyRequest) => {
    const { items, plan } = await this.personas.list(actorOf(request));
    return { items: items.map(this.dto(request)), plan };
  };

  get = async (request: FastifyRequest<IdParams>) =>
    this.dto(request)(await this.personas.get(actorOf(request), request.params.id));

  create = async (request: FastifyRequest<{ Body: CreatePersonaBody }>, reply: FastifyReply) => {
    const result = await this.personas.create(actorOf(request), request.body);
    if (result.kind === 'payment_required') return reply.status(402).send({ checkout: result.checkout });
    return reply.status(201).send(this.dto(request)(result.persona));
  };

  update = async (request: FastifyRequest<IdParams & { Body: UpdatePersonaBody }>) => {
    const { dndUntil, ...rest } = request.body;
    const persona = await this.personas.update(actorOf(request), request.params.id, {
      ...rest,
      ...(dndUntil === undefined ? {} : { dndUntil: dndUntil === null ? null : new Date(dndUntil) }),
    });
    return this.dto(request)(persona);
  };

  pause = async (request: FastifyRequest<IdParams>) =>
    this.dto(request)(await this.personas.pause(actorOf(request), request.params.id));

  resume = async (request: FastifyRequest<IdParams>) =>
    this.dto(request)(await this.personas.resume(actorOf(request), request.params.id));

  retire = async (request: FastifyRequest<IdParams & { Body: { confirm: string } }>, reply: FastifyReply) => {
    await this.personas.retire(actorOf(request), request.params.id, request.body.confirm);
    return reply.status(204).send();
  };

  share = async (request: FastifyRequest<IdParams>) => this.personas.share(actorOf(request), request.params.id);

  uploadAvatar = async (request: FastifyRequest<IdParams>) => {
    const body = request.body as Buffer;
    const persona = await this.personas.setAvatar(
      actorOf(request),
      request.params.id,
      new Uint8Array(body),
      request.headers['content-type'] ?? '',
    );
    return this.dto(request)(persona);
  };

  removeAvatar = async (request: FastifyRequest<IdParams>) =>
    this.dto(request)(await this.personas.removeAvatar(actorOf(request), request.params.id));
}
