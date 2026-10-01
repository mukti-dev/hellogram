import { describe, expect, it } from 'vitest';
import type { HealthProbe } from '@hellogram/domain';
import { HealthService } from './health.service.js';

const probe = (name: string, result: 'ok' | 'down' | Error): HealthProbe => ({
  name,
  check: () => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result)),
});

describe('HealthService', () => {
  it('is ok when every probe is ok', async () => {
    const service = new HealthService([probe('db', 'ok'), probe('redis', 'ok')], '1.0.0');
    await expect(service.check()).resolves.toEqual({
      status: 'ok',
      checks: { db: 'ok', redis: 'ok' },
      version: '1.0.0',
    });
  });

  it('is degraded when some probes fail, treating thrown errors as down', async () => {
    const service = new HealthService([probe('db', 'ok'), probe('redis', new Error('boom'))], 'x');
    const result = await service.check();
    expect(result.status).toBe('degraded');
    expect(result.checks.redis).toBe('down');
  });

  it('is down when every probe fails', async () => {
    const service = new HealthService([probe('db', 'down')], 'x');
    expect((await service.check()).status).toBe('down');
  });
});
