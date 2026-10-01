import type { PhoneIdentityVerifier, VerifiedPhone } from '@hellogram/domain';
import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';

/** Google's public keys for Firebase Auth ID tokens (rotated; jose caches them). */
const FIREBASE_JWKS = 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com';

/**
 * Verifies Firebase Auth ID tokens without a service account: RS256 signature against
 * Google's keys, issuer/audience = our project, and a phone sign-in.
 */
export class FirebaseIdTokenVerifier implements PhoneIdentityVerifier {
  private readonly keys: JWTVerifyGetKey;

  constructor(
    private readonly projectId: string,
    keys?: JWTVerifyGetKey,
  ) {
    this.keys = keys ?? createRemoteJWKSet(new URL(FIREBASE_JWKS));
  }

  async verify(idToken: string): Promise<VerifiedPhone | null> {
    try {
      const { payload } = await jwtVerify(idToken, this.keys, {
        issuer: `https://securetoken.google.com/${this.projectId}`,
        audience: this.projectId,
        algorithms: ['RS256'],
      });
      const firebase = payload['firebase'] as { sign_in_provider?: string } | undefined;
      const phone = payload['phone_number'];
      const authTime = payload['auth_time'];
      if (firebase?.sign_in_provider !== 'phone' || typeof phone !== 'string' || typeof authTime !== 'number') return null;
      if (!payload.sub) return null;
      return { phone, authTime: new Date(authTime * 1000) };
    } catch {
      return null;
    }
  }
}
