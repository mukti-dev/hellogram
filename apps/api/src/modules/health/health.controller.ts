import type { HealthService } from '@hellogram/application';
import type { FastifyReply, FastifyRequest } from 'fastify';

export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /** Liveness: the process is up. Never touches dependencies. */
  live = async (_request: FastifyRequest, reply: FastifyReply) => reply.send({ status: 'ok' });

  /** Readiness: dependencies are reachable. 503 when not fully healthy. */
  ready = async (_request: FastifyRequest, reply: FastifyReply) => {
    const result = await this.healthService.check();
    return reply.status(result.status === 'ok' ? 200 : 503).send(result);
  };
}
