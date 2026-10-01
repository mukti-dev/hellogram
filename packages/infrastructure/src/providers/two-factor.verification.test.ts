import { afterEach, describe, expect, it, vi } from 'vitest';
import { TwoFactorVerification } from './two-factor.verification.js';

const logger = { warn: vi.fn() };
const KEY = 'secret-api-key-123';
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

function fake(handler: (path: string) => Response) {
  const calls: string[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url);
      return handler(new URL(url).pathname);
    }),
  );
  return calls;
}

const make = (extra: Partial<ConstructorParameters<typeof TwoFactorVerification>[0]> = {}) =>
  new TwoFactorVerification({ apiKey: KEY, retryDelayMs: 1, ...extra }, logger);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('TwoFactorVerification', () => {
  it('asks 2Factor to make and send a 6-digit code, and keeps the session id', async () => {
    const calls = fake(() => reply({ Status: 'Success', Details: 'ab88279e-0105-415f-912e-2f24162b8cbb' }));
    expect(await make().send('+919876543210')).toEqual({ reference: 'ab88279e-0105-415f-912e-2f24162b8cbb' });
    expect(calls[0]).toBe(`https://2factor.in/API/V1/${KEY}/SMS/9876543210/AUTOGEN`);
  });

  it('uses the approved SMS template when one is configured', async () => {
    const calls = fake(() => reply({ Status: 'Success', Details: 's1' }));
    await make({ templateName: 'Hellogram OTP' }).send('+919876543210');
    expect(calls[0]).toBe(`https://2factor.in/API/V1/${KEY}/SMS/9876543210/AUTOGEN/Hellogram%20OTP`);
  });

  it('checks codes: matched, mismatch, expired', async () => {
    const answers: Record<string, unknown> = {
      '111111': { Status: 'Success', Details: 'OTP Matched' },
      '222222': { Status: 'Error', Details: 'OTP Mismatch' },
      '333333': { Status: 'Error', Details: 'OTP Expired' },
      // 2Factor's own docs show "OTP Matched" under Status "Error".
      '444444': { Status: 'Error', Details: 'OTP Matched' },
    };
    const calls = fake((path) => reply(answers[path.split('/').pop()!]));
    const tf = make();
    expect(await tf.check('+919876543210', 'sess-1', '111111')).toBe('valid');
    expect(await tf.check('+919876543210', 'sess-1', '222222')).toBe('invalid');
    expect(await tf.check('+919876543210', 'sess-1', '333333')).toBe('expired');
    expect(await tf.check('+919876543210', 'sess-1', '444444')).toBe('valid');
    expect(calls[0]).toBe(`https://2factor.in/API/V1/${KEY}/SMS/VERIFY/sess-1/111111`);
  });

  it('re-checks a mismatch once (2Factor can lag right after sending)', async () => {
    let n = 0;
    const calls = fake(() => reply(++n === 1 ? { Status: 'Error', Details: 'OTP Mismatch' } : { Status: 'Success', Details: 'OTP Matched' }));
    expect(await make().check('+919876543210', 'sess-1', '565059')).toBe('valid');
    expect(calls).toHaveLength(2);
  });

  it('fails cleanly on a bad API key or an outage, and never logs the key, number or code', async () => {
    fake(() => reply({ Status: 'Error', Details: 'Invalid API Key' }));
    await expect(make().send('+919876543210')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    await expect(make().check('+919876543210', 'sess-1', '123456')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    vi.stubGlobal('fetch', vi.fn(async (url: string) => { throw new TypeError(`fetch failed for ${url}`); }));
    await expect(make().send('+919876543210')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const logged = JSON.stringify(logger.warn.mock.calls);
    for (const secret of [KEY, '9876543210', '123456']) expect(logged).not.toContain(secret);
  });

  it('only accepts Indian mobile numbers', async () => {
    const calls = fake(() => reply({}));
    await expect(make().send('+14155550100')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });
});
