import type { AccessTokenIssuer } from '@hellogram/domain';
import { SignJWT, jwtVerify } from 'jose';

const ISSUER = 'hellogram';
const AUDIENCE = 'hellogram-app';

/** Short-lived HS256 access JWTs. Claims carry only opaque ids — never phone or email. */
export class JoseAccessTokenIssuer implements AccessTokenIssuer {
  private readonly key: Uint8Array;

  constructor(
    secret: string,
    private readonly ttlSeconds = 15 * 60,
  ) {
    this.key = new TextEncoder().encode(secret);
  }

  async issue(claims: { accountId: string; sessionId: string }) {
    const token = await new SignJWT({ sid: claims.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(claims.accountId)
      .setIssuer(ISSUER)
      .setAudience(AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.ttlSeconds}s`)
      .sign(this.key);
    return { token, expiresIn: this.ttlSeconds };
  }

  async verify(token: string) {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ISSUER,
        audience: AUDIENCE,
        algorithms: ['HS256'],
      });
      if (typeof payload.sub !== 'string' || typeof payload.sid !== 'string') return null;
      return { accountId: payload.sub, sessionId: payload.sid };
    } catch {
      return null;
    }
  }
}
