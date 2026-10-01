import { AccountService, AuthService, HealthService, OtpVerifier, PersonaService, PhoneProofChecker } from '@hellogram/application';
import {
  FakeAccounts,
  FakeClock,
  FakeEmail,
  FakeEphemeralStore,
  FakeLimiter,
  FakeOtps,
  FakePersonas,
  FakeSessions,
  FakeSms,
  FakeTokens,
  FakeTrustedDevices,
  fakeCrypto,
  fakePasswords,
  fakeQr,
  fakeStorage,
  passthroughUow,
} from '@hellogram/application/testing';
import { LocalEventPublisher } from '@hellogram/infrastructure';
import type { AppContainer } from '../src/container.js';

export const TEST_CONSENT = '2026-09-v1';

/** In-memory container for HTTP-level tests (no Postgres/Redis). */
export function makeTestContainer(options: { probe?: 'ok' | 'down'; bypass?: boolean } = {}) {
  const clock = new FakeClock();
  const repos = {
    accounts: new FakeAccounts(),
    sessions: new FakeSessions(),
    otps: new FakeOtps(),
    trustedDevices: new FakeTrustedDevices(),
  };
  const sms = new FakeSms();
  const email = new FakeEmail();
  const limiter = new FakeLimiter();
  const otp = new OtpVerifier(repos.otps, fakeCrypto, clock, { bypass: options.bypass ?? false, sms });
  const authService = new AuthService(
    {
      repos,
      uow: passthroughUow(repos),
      otp,
      proofs: new PhoneProofChecker({ otp, firebase: null, clock }),
      passwords: fakePasswords,
      pendingSignups: new FakeEphemeralStore(),
      deviceLogins: new FakeEphemeralStore(),
      crypto: fakeCrypto,
      tokens: new FakeTokens(),
      limiter,
      clock,
    },
    { consentVersion: TEST_CONSENT, sessionTtlDays: 90 },
  );
  const accountService = new AccountService({ ...repos, otp, email, crypto: fakeCrypto, limiter, clock });

  const events = new LocalEventPublisher();
  const personaService = new PersonaService({
    personas: new FakePersonas(),
    crypto: fakeCrypto,
    clock,
    events,
    storage: fakeStorage,
    qr: fakeQr,
    publicBaseUrl: 'http://localhost:5173',
    codeDigits: 6,
  });

  // Only auth/account/persona services are in-memory; routes for later modules are
  // covered by the Postgres integration suite, so their services are left out here.
  const container = {
    events,
    healthService: new HealthService([{ name: 'database', check: async () => options.probe ?? 'ok' }], 'test'),
    authService,
    accountService,
    personaService,
    cookie: { secure: false, maxAgeDays: 90 },
    avatarUrl: (key: string | null) => (key ? `/media/${key}` : null),
    close: async () => {},
  } as unknown as AppContainer;
  return { container, repos, sms, email, clock };
}
