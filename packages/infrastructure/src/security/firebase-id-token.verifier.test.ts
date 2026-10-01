import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet } from 'jose';
import { beforeAll, describe, expect, it } from 'vitest';
import { FirebaseIdTokenVerifier } from './firebase-id-token.verifier.js';

const PROJECT = 'hellogram-test';
let privateKey: Awaited<ReturnType<typeof generateKeyPair>>["privateKey"];
let verifier: FirebaseIdTokenVerifier;

beforeAll(async () => {
  const pair = await generateKeyPair('RS256');
  privateKey = pair.privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'RS256' };
  verifier = new FirebaseIdTokenVerifier(PROJECT, createLocalJWKSet({ keys: [jwk] }));
});

const token = (over: { iss?: string; aud?: string; provider?: string; phone?: string | null; exp?: string } = {}) =>
  new SignJWT({
    ...(over.phone === null ? {} : { phone_number: over.phone ?? '+919876543210' }),
    auth_time: Math.floor(Date.now() / 1000) - 5,
    firebase: { sign_in_provider: over.provider ?? 'phone', identities: {} },
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
    .setIssuer(over.iss ?? `https://securetoken.google.com/${PROJECT}`)
    .setAudience(over.aud ?? PROJECT)
    .setSubject('firebase-uid-1')
    .setIssuedAt()
    .setExpirationTime(over.exp ?? '1h')
    .sign(privateKey);

describe('FirebaseIdTokenVerifier', () => {
  it('accepts a valid phone sign-in token', async () => {
    const result = await verifier.verify(await token());
    expect(result?.phone).toBe('+919876543210');
    expect(result?.authTime).toBeInstanceOf(Date);
  });

  it('rejects other projects, other issuers, non-phone sign-ins and expired tokens', async () => {
    expect(await verifier.verify(await token({ aud: 'someone-else' }))).toBeNull();
    expect(await verifier.verify(await token({ iss: 'https://securetoken.google.com/other' }))).toBeNull();
    expect(await verifier.verify(await token({ provider: 'password' }))).toBeNull();
    expect(await verifier.verify(await token({ phone: null }))).toBeNull();
    expect(await verifier.verify(await token({ exp: '-1s' }))).toBeNull();
    expect(await verifier.verify('not-a-jwt')).toBeNull();
  });

  it('rejects tokens signed with a different key', async () => {
    const other = await generateKeyPair('RS256');
    const forged = await new SignJWT({ phone_number: '+919876543210', auth_time: 1, firebase: { sign_in_provider: 'phone' } })
      .setProtectedHeader({ alg: 'RS256', kid: 'k1' })
      .setIssuer(`https://securetoken.google.com/${PROJECT}`)
      .setAudience(PROJECT)
      .setSubject('x')
      .setExpirationTime('1h')
      .sign(other.privateKey);
    expect(await verifier.verify(forged)).toBeNull();
  });
});
