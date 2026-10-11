import { DomainError, type IceServer, type TurnCredentialIssuer } from '@hellogram/domain';
import { ErrorCode } from '@hellogram/shared';

/**
 * Cloudflare's TURN service (Realtime → TURN): short-lived credentials from its API, one set per
 * side of a call. Calls are relay-only, so only the TURN servers are kept (no STUN), and never the
 * alternate port 53, which browsers block (it would only add a timeout before the call connects).
 * https://developers.cloudflare.com/realtime/turn/generate-credentials/
 */
export class CloudflareTurnIssuer implements TurnCredentialIssuer {
  constructor(
    private readonly keyId: string,
    private readonly apiToken: string,
    /** As long as a call may last (the in-call lock), so a running call never loses its relay. */
    private readonly ttlSeconds = 4 * 60 * 60,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async issue(): Promise<IceServer[]> {
    let servers: IceServer[] = [];
    try {
      const response = await this.fetchImpl(
        `https://rtc.live.cloudflare.com/v1/turn/keys/${encodeURIComponent(this.keyId)}/credentials/generate-ice-servers`,
        {
          method: 'POST',
          headers: { authorization: `Bearer ${this.apiToken}`, 'content-type': 'application/json' },
          body: JSON.stringify({ ttl: this.ttlSeconds }),
          signal: AbortSignal.timeout(5_000),
        },
      );
      if (response.ok) servers = turnServers(await response.json());
    } catch {
      // Unreachable or timed out: same as no servers.
    }
    if (servers.length === 0) {
      throw new DomainError(ErrorCode.SERVICE_UNAVAILABLE, 'Calls are unavailable right now. Please try again in a moment.');
    }
    return servers;
  }
}

const PORT_53 = /:53(\?|$)/;

/** The TURN entries of Cloudflare's `iceServers` (with credentials), minus port 53. */
export function turnServers(body: unknown): IceServer[] {
  const list = (body as { iceServers?: unknown })?.iceServers;
  if (!Array.isArray(list)) return [];
  return list.flatMap((entry: { urls?: unknown; username?: unknown; credential?: unknown }) => {
    if (typeof entry?.username !== 'string' || typeof entry.credential !== 'string') return [];
    const urls = (Array.isArray(entry.urls) ? entry.urls : [entry.urls]).filter(
      (url): url is string => typeof url === 'string' && /^turns?:/.test(url) && !PORT_53.test(url),
    );
    return urls.length > 0 ? [{ urls, username: entry.username, credential: entry.credential }] : [];
  });
}
