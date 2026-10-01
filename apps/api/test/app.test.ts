import { DomainError } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { makeTestContainer } from './helpers.js';

const fakeContainer = (probe: 'ok' | 'down') => makeTestContainer({ probe }).container;

let app: FastifyInstance;
afterEach(async () => app?.close());

describe('health routes', () => {
  it('GET /health/live is always ok', async () => {
    app = await buildApp({ container: fakeContainer('down'), corsOrigins: [] });
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready returns 200 when dependencies are up', async () => {
    app = await buildApp({ container: fakeContainer('ok'), corsOrigins: [] });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ status: 'ok', checks: { database: 'ok' } });
  });

  it('GET /health/ready returns 503 when a dependency is down', async () => {
    app = await buildApp({ container: fakeContainer('down'), corsOrigins: [] });
    const res = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(res.statusCode).toBe(503);
  });
});

describe('error handling', () => {
  it('maps DomainError codes to status and the standard error body', async () => {
    app = await buildApp({ container: fakeContainer('ok'), corsOrigins: [] });
    app.get('/boom', async () => {
      throw new DomainError(ErrorCode.NUMBER_UNAVAILABLE, 'This number is no longer available');
    });
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(410);
    expect(res.json()).toEqual({
      error: { code: 'NUMBER_UNAVAILABLE', message: 'This number is no longer available' },
    });
  });

  it('hides unexpected errors behind a generic 500', async () => {
    app = await buildApp({ container: fakeContainer('ok'), corsOrigins: [] });
    app.get('/crash', async () => {
      throw new Error('database password is hunter2');
    });
    const res = await app.inject({ method: 'GET', url: '/crash' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ error: { code: 'INTERNAL', message: 'Something went wrong' } });
  });

  it('returns the standard body for unknown routes', async () => {
    app = await buildApp({ container: fakeContainer('ok'), corsOrigins: [] });
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe('NOT_FOUND');
  });

  it('sets security headers', async () => {
    app = await buildApp({ container: fakeContainer('ok'), corsOrigins: [] });
    const res = await app.inject({ method: 'GET', url: '/health/live' });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
  });
});
