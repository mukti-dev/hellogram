import type { PrismaClient } from '@hellogram/db';
import type { HealthProbe, ProbeStatus } from '@hellogram/domain';

export class PostgresHealthProbe implements HealthProbe {
  readonly name = 'database';

  constructor(private readonly prisma: PrismaClient) {}

  async check(): Promise<ProbeStatus> {
    await this.prisma.$queryRaw`SELECT 1`;
    return 'ok';
  }
}
