import { TURN_TTL_SECONDS, type IceServer, type TurnCredentialIssuer } from '@hellogram/domain';
import { createHmac } from 'node:crypto';

/**
 * Local coturn for development and CI ("use-auth-secret", TURN REST API): username =
 * "<expiry>:<label>", credential = base64(HMAC-SHA1(secret, username)). Expires after 10 minutes.
 * Production uses Cloudflare's TURN service instead (cloudflare-turn.ts).
 */
export class CoturnCredentialIssuer implements TurnCredentialIssuer {
  constructor(
    private readonly urls: string[],
    private readonly secret: string,
  ) {}

  async issue(label: string): Promise<IceServer[]> {
    const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${label}`;
    const credential = createHmac('sha1', this.secret).update(username).digest('base64');
    return [{ urls: this.urls, username, credential }];
  }
}
