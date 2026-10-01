import { afterEach, describe, expect, it, vi } from 'vitest';
import { Fast2SmsProvider } from './fast2sms.provider.js';

const logger = { warn: vi.fn(), info: vi.fn() };
const reply = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status }));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('Fast2SmsProvider', () => {
  it('sends our own code on the OTP route, key in the header, 10-digit number', async () => {
    const fetch = reply(200, { return: true, request_id: 'r1', message: ['SMS sent successfully.'] });
    vi.stubGlobal('fetch', fetch);
    await new Fast2SmsProvider({ apiKey: 'KEY', route: 'otp' }, logger).sendOtp('+919876543210', '482913');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.fast2sms.com/dev/bulkV2');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe('KEY');
    expect(JSON.parse(String(init.body))).toEqual({ route: 'otp', variables_values: '482913', numbers: '9876543210' });
    expect(url).not.toContain('KEY'); // never in the URL (server logs, proxies)
  });

  it('uses the DLT OTP API with our template when configured', async () => {
    const fetch = reply(200, { return: true, status_code: 200, request_id: 'r2', message: 'OTP sent successfully' });
    vi.stubGlobal('fetch', fetch);
    await new Fast2SmsProvider({ apiKey: 'KEY', route: 'dlt', otpTemplateId: 'T123' }, logger).sendOtp('+919876543210', '482913');

    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://www.fast2sms.com/dev/otp/send');
    expect(JSON.parse(String(init.body))).toEqual({ mobile: '9876543210', otp_id: 'T123', otp: '482913', otp_length: 6, otp_expiry: 10 });
  });

  it('treats "return": false as a failure even with HTTP 200, and logs why without the full number', async () => {
    vi.stubGlobal('fetch', reply(200, { return: false, status_code: 996, message: 'Before using OTP SMS API, complete KYC' }));
    const send = new Fast2SmsProvider({ apiKey: 'KEY', route: 'otp' }, logger).sendOtp('+919876543210', '482913');
    await expect(send).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    const [details] = logger.warn.mock.calls[0] as [Record<string, unknown>];
    expect(details).toMatchObject({ code: 996, reason: 'Before using OTP SMS API, complete KYC', to: '987•••••10' });
    expect(JSON.stringify(details)).not.toContain('9876543210');
    expect(JSON.stringify(details)).not.toContain('482913');
  });

  it('fails cleanly on HTTP errors and network errors', async () => {
    vi.stubGlobal('fetch', reply(401, { return: false, status_code: 412, message: 'Invalid Authentication, Check Authorization Key' }));
    await expect(new Fast2SmsProvider({ apiKey: 'bad', route: 'otp' }, logger).sendOtp('+919876543210', '1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed'); }));
    await expect(new Fast2SmsProvider({ apiKey: 'KEY', route: 'otp' }, logger).sendOtp('+919876543210', '1')).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
  });

  it('only sends to Indian mobile numbers', async () => {
    const fetch = reply(200, { return: true });
    vi.stubGlobal('fetch', fetch);
    await expect(new Fast2SmsProvider({ apiKey: 'KEY', route: 'otp' }, logger).sendOtp('+14155550100', '1')).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(fetch).not.toHaveBeenCalled();
  });
});
