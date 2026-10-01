import type { HealthProbe } from '@hellogram/domain';
import type { HealthResponse } from '@hellogram/shared';

const PROBE_TIMEOUT_MS = 2_000;

/** Use case: report whether the process and its dependencies are healthy. */
export class HealthService {
  constructor(
    private readonly probes: readonly HealthProbe[],
    private readonly version: string,
  ) {}

  async check(): Promise<HealthResponse> {
    const results = await Promise.all(
      this.probes.map(async (probe) => [probe.name, await runProbe(probe)] as const),
    );
    const checks = Object.fromEntries(results);
    const downCount = results.filter(([, status]) => status === 'down').length;

    return {
      status: downCount === 0 ? 'ok' : downCount === results.length ? 'down' : 'degraded',
      checks,
      version: this.version,
    };
  }
}

async function runProbe(probe: HealthProbe): Promise<'ok' | 'down'> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<'down'>((resolve) => {
    timer = setTimeout(() => resolve('down'), PROBE_TIMEOUT_MS);
  });
  try {
    return await Promise.race([probe.check().catch(() => 'down' as const), timeout]);
  } finally {
    clearTimeout(timer);
  }
}
