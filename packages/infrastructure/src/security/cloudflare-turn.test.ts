import { describe, expect, it } from 'vitest';
import { CloudflareTurnIssuer, turnServers } from './cloudflare-turn.js';

// Cloudflare's documented response, plus a port 53 URL.
const generated = {
  iceServers: [
    { urls: ['stun:stun.cloudflare.com:3478', 'stun:stun.cloudflare.com:53'] },
    {
      urls: [
        'turn:turn.cloudflare.com:3478?transport=udp',
        'turn:turn.cloudflare.com:53?transport=udp',
        'turn:turn.cloudflare.com:3478?transport=tcp',
        'turns:turn.cloudflare.com:5349?transport=tcp',
        'turns:turn.cloudflare.com:443?transport=tcp',
      ],
      username: 'user-1',
      credential: 'secret-1',
    },
  ],
};

const fetchReturning = (status: number, body: unknown, seen: { url: string; init: RequestInit }[] = []) =>
  (async (url: string, init: RequestInit) => {
    seen.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;

describe('Cloudflare TURN credentials', () => {
  it('asks for credentials that last as long as a call, with the TURN key', async () => {
    const seen: { url: string; init: RequestInit }[] = [];
    const issuer = new CloudflareTurnIssuer('key-id', 'api-token', 4 * 60 * 60, fetchReturning(201, generated, seen));
    const servers = await issuer.issue();
    expect(seen[0]?.url).toBe('https://rtc.live.cloudflare.com/v1/turn/keys/key-id/credentials/generate-ice-servers');
    expect(seen[0]?.init.headers).toMatchObject({ authorization: 'Bearer api-token' });
    expect(JSON.parse(String(seen[0]?.init.body))).toEqual({ ttl: 14_400 });
    expect(servers).toEqual([
      {
        urls: ['turn:turn.cloudflare.com:3478?transport=udp', 'turn:turn.cloudflare.com:3478?transport=tcp', 'turns:turn.cloudflare.com:5349?transport=tcp', 'turns:turn.cloudflare.com:443?transport=tcp'],
        username: 'user-1',
        credential: 'secret-1',
      },
    ]);
  });

  it('keeps only TURN (calls are relay-only) and never port 53', () => {
    const urls = turnServers(generated).flatMap((s) => s.urls);
    expect(urls.some((u) => u.startsWith('stun:'))).toBe(false);
    expect(urls.some((u) => /:53(\?|$)/.test(u))).toBe(false);
    expect(urls).toContain('turns:turn.cloudflare.com:5349?transport=tcp');
  });

  it('says calls are unavailable when Cloudflare refuses, answers nonsense or is unreachable', async () => {
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as typeof fetch;
    for (const fetchImpl of [fetchReturning(401, { errors: ['bad token'] }), fetchReturning(201, { iceServers: [{ urls: ['stun:x'] }] }), down]) {
      await expect(new CloudflareTurnIssuer('k', 't', 60, fetchImpl).issue()).rejects.toMatchObject({ code: 'SERVICE_UNAVAILABLE' });
    }
  });
});
