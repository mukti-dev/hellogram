import { TURN_TTL_SECONDS, type IceServer, type TurnCredentialIssuer } from '@hellogram/domain';
import { createHmac } from 'node:crypto';

/**
 * coturn "use-auth-secret" (TURN REST API): username = "<expiry>:<callId>",
 * credential = base64(HMAC-SHA1(secret, username)). Expires after 10 minutes,
 * so nobody can use our relay for free.
 */
export class CoturnCredentialIssuer implements TurnCredentialIssuer {
  constructor(
    private readonly urls: string[],
    private readonly secret: string,
  ) {}

  issue(callId: string): IceServer[] {
    const username = `${Math.floor(Date.now() / 1000) + TURN_TTL_SECONDS}:${callId}`;
    const credential = createHmac('sha1', this.secret).update(username).digest('base64');
    return [{ urls: this.urls, username, credential }];
  }
}
