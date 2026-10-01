import { afterEach, describe, expect, it, vi } from 'vitest';
import { MessageCentralVerification } from './message-central.verification.js';

const logger = { warn: vi.fn() };
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
const jwt = (expSeconds: number) =>
  `h.${Buffer.from(JSON.stringify({ sub: 'C-1', exp: expSeconds })).toString('base64url')}.s`;

type Route = (url: URL, init: RequestInit) => Response;
function fakeApi(routes: Record<string, Route>) {
  const calls: { url: URL; init: RequestInit }[] = [];
  const fetch = vi.fn(async (input: string, init: RequestInit) => {
    const url = new URL(input);
    calls.push({ url, init });
    const route = routes[url.pathname];
    if (!route) throw new Error(`unexpected ${url.pathname}`);
    return route(url, init);
  });
  vi.stubGlobal('fetch', fetch);
  return calls;
}

const TOKEN = jwt(Math.floor(Date.now() / 1000) + 3600);
const tokenRoute: Route = () => json(200, { responseCode: 200, token: TOKEN });
const make = () => new MessageCentralVerification({ customerId: 'C-1', password: 'p@ss', email: 'dev@example.com' }, logger);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('MessageCentralVerification', () => {
  it('logs in with the base64 password and sends a 6-digit SMS code', async () => {
    const calls = fakeApi({
      '/auth/v1/authentication/token': tokenRoute,
      '/verification/v3/send': () => json(200, { responseCode: 200, message: 'SUCCESS', data: { verificationId: 2949, responseCode: '200', timeout: '60' } }),
    });
    expect(await make().send('+919876543210')).toEqual({ reference: '2949' });

    const [login, send] = calls;
    expect(login!.url.searchParams.get('key')).toBe(Buffer.from('p@ss').toString('base64'));
    expect(login!.url.searchParams.get('customerId')).toBe('C-1');
    expect(login!.url.searchParams.get('scope')).toBe('NEW');
    expect(send!.init.method).toBe('POST');
    expect(Object.fromEntries(send!.url.searchParams)).toEqual({
      countryCode: '91', customerId: 'C-1', flowType: 'SMS', mobileNumber: '9876543210', otpLength: '6',
    });
    expect((send!.init.headers as Record<string, string>).authToken).toBe(TOKEN);
  });

  it('reuses the login token until it is about to expire', async () => {
    const calls = fakeApi({
      '/auth/v1/authentication/token': tokenRoute,
      '/verification/v3/send': () => json(200, { responseCode: 200, data: { verificationId: '1' } }),
    });
    const mc = make();
    await mc.send('+919876543210');
    await mc.send('+919876543211');
    expect(calls.filter((c) => c.url.pathname.includes('/token'))).toHaveLength(1);
  });

  it('logs in again once when the token is rejected', async () => {
    let sends = 0;
    const calls = fakeApi({
      '/auth/v1/authentication/token': tokenRoute,
      '/verification/v3/send': () => (++sends === 1 ? json(401, { message: 'UNAUTHORIZED' }) : json(200, { responseCode: 200, data: { verificationId: '7' } })),
    });
    expect(await make().send('+919876543210')).toEqual({ reference: '7' });
    expect(calls.filter((c) => c.url.pathname.includes('/token'))).toHaveLength(2);
  });

  it('checks a code: right, wrong, expired', async () => {
    const replies: Record<string, Response> = {};
    const calls = fakeApi({
      '/auth/v1/authentication/token': tokenRoute,
      '/verification/v3/validateOtp': (url) => replies[url.searchParams.get('code')!]!,
    });
    replies['111111'] = json(200, { responseCode: 200, data: { verificationStatus: 'VERIFICATION_COMPLETED' } });
    replies['222222'] = json(400, { responseCode: 702, message: 'WRONG_OTP_PROVIDED' });
    replies['333333'] = json(400, { responseCode: 705, message: 'VERIFICATION_EXPIRED' });
    replies['444444'] = json(400, { responseCode: 703, message: 'ALREADY_VERIFIED' });
    const mc = make();
    expect(await mc.check('+919876543210', '2949', '111111')).toBe('valid');
    expect(await mc.check('+919876543210', '2949', '222222')).toBe('invalid');
    expect(await mc.check('+919876543210', '2949', '333333')).toBe('expired');
    expect(await mc.check('+919876543210', '2949', '444444')).toBe('expired');

    const check = calls.find((c) => c.url.pathname.includes('validateOtp'))!;
    expect(check.init.method).toBe('GET');
    expect(Object.fromEntries(check.url.searchParams)).toMatchObject({ verificationId: '2949', mobileNumber: '9876543210', countryCode: '91', customerId: 'C-1' });
  });

  it('turns "already sent" into a friendly wait message', async () => {
    fakeApi({
      '/auth/v1/authentication/token': tokenRoute,
      '/verification/v3/send': () => json(400, { responseCode: 506, message: 'REQUEST_ALREADY_EXISTS' }),
    });
    await expect(make().send('+919876543210')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
  });

  it('fails cleanly on bad credentials, outages and unknown errors — without logging secrets', async () => {
    fakeApi({ '/auth/v1/authentication/token': () => json(400, { responseCode: 501, message: 'INVALID_CUSTOMER_ID' }) });
    await expect(make().send('+919876543210')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    fakeApi({
      '/auth/v1/authentication/token': tokenRoute,
      '/verification/v3/send': () => json(500, { responseCode: 500, message: 'SERVER_ERROR' }),
    });
    await expect(make().send('+919876543210')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(make().check('+919876543210', '1', '123456')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });

    const logged = JSON.stringify(logger.warn.mock.calls);
    for (const secret of ['p@ss', Buffer.from('p@ss').toString('base64'), '9876543210', '123456', TOKEN]) expect(logged).not.toContain(secret);
  });

  it('uses a dashboard token as-is, without logging in', async () => {
    const calls = fakeApi({
      '/verification/v3/send': () => json(200, { responseCode: 200, data: { verificationId: '55' } }),
    });
    const mc = new MessageCentralVerification({ customerId: 'C-1', authToken: 'DASHBOARD-TOKEN' }, logger);
    expect(await mc.send('+919876543210')).toEqual({ reference: '55' });
    expect(calls).toHaveLength(1);
    expect((calls[0]!.init.headers as Record<string, string>).authToken).toBe('DASHBOARD-TOKEN');
  });

  it('says clearly when a dashboard token is rejected (and never logs it)', async () => {
    fakeApi({ '/verification/v3/send': () => json(401, { message: 'UNAUTHORIZED' }) });
    const mc = new MessageCentralVerification({ customerId: 'C-1', authToken: 'OLD-TOKEN' }, logger);
    await expect(mc.send('+919876543210')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    expect(JSON.stringify(logger.warn.mock.calls)).toContain('create a new one in the dashboard');
    expect(JSON.stringify(logger.warn.mock.calls)).not.toContain('OLD-TOKEN');
  });

  it('only accepts Indian mobile numbers', async () => {
    const calls = fakeApi({});
    await expect(make().send('+14155550100')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(calls).toHaveLength(0);
  });
});
