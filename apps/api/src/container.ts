import {
  AccountService,
  AuthService,
  BillingService,
  BlockService,
  CallService,
  ChatService,
  ComplianceService,
  HealthService,
  MaintenanceService,
  NotificationService,
  PushTriggers,
  SafetyService,
  OtpVerifier,
  PersonaService,
  PhoneProofChecker,
  PinService,
  RequestService,
  type RequestTxRepos,
} from '@hellogram/application';
import { createPrismaClient } from '@hellogram/db';
import { systemClock, type AuthRepositories, type PhoneIdentityVerifier } from '@hellogram/domain';
import {
  ConsoleEmailProvider,
  ConsoleSmsProvider,
  Argon2PinHasher,
  DevBillingProvider,
  FirebaseIdTokenVerifier,
  NoSmsProvider,
  NotificationQueue,
  PrismaAccountLifecycleRepository,
  PrismaAuditRepository,
  PrismaBillingRepository,
  PrismaGrievanceRepository,
  PrismaPushSubscriptionRepository,
  RazorpayBillingProvider,
  CoturnCredentialIssuer,
  InProcessCallTimeouts,
  PrismaCallRepository,
  RedisCallLock,
  JoseAccessTokenIssuer,
  Msg91SmsProvider,
  SmtpEmailProvider,
  TurnstileVerifier,
  PrismaPinRepository,
  RedisUnlockTokenStore,
  LocalDiskStorage,
  PrismaBlockRepository,
  PrismaConversationRepository,
  PrismaMaintenanceRepository,
  PrismaReportRepository,
  PrismaConversationBootstrapRepository,
  PrismaPersonaRepository,
  PrismaReachRepository,
  PrismaRequestRepository,
  QrCodeSvgRenderer,
  LocalEventPublisher,
  NodeCryptoService,
  PostgresHealthProbe,
  PrismaAccountRepository,
  PrismaOtpChallengeRepository,
  PrismaSessionRepository,
  PrismaUnitOfWork,
  RedisHealthProbe,
  RedisRateLimiter,
  createRedisClient,
  type Db,
  type Redis,
} from '@hellogram/infrastructure';
import type { Logger } from 'pino';
import type { ApiEnv } from './config/env.js';

/**
 * Composition root: the only place that knows concrete implementations.
 * Controllers receive services; services receive ports (interfaces).
 */
export interface AppContainer {
  redis?: Redis;
  events: LocalEventPublisher;
  healthService: HealthService;
  authService: AuthService;
  accountService: AccountService;
  personaService: PersonaService;
  requestService: RequestService;
  blockService: BlockService;
  chatService: ChatService;
  safetyService: SafetyService;
  pinService: PinService;
  callService: CallService;
  billingService: BillingService;
  notificationService: NotificationService;
  pushTriggers: PushTriggers;
  notificationQueue?: NotificationQueue;
  vapidPublicKey?: string | undefined;
  billingDevTools: boolean;
  phoneAuthProvider: 'otp' | 'firebase';
  complianceService: ComplianceService;
  grievanceOfficer: { name: string; email: string };
  maintenanceService: MaintenanceService;
  avatarUrl: (key: string | null) => string | null;
  mediaDir?: string;
  turnstile?: TurnstileVerifier;
  trustProxy?: boolean | number | string[];
  cookie: { secure: boolean; maxAgeDays: number };
  close(): Promise<void>;
}

export const APP_VERSION = process.env.npm_package_version ?? '0.0.0';

const authRepos = (db: Db): AuthRepositories => ({
  accounts: new PrismaAccountRepository(db),
  sessions: new PrismaSessionRepository(db),
  otps: new PrismaOtpChallengeRepository(db),
});

export interface ContainerOverrides {
  /** Tests: stand-in for Firebase token verification. */
  phoneVerifier?: PhoneIdentityVerifier;
}

export function createContainer(env: ApiEnv, logger: Logger, overrides: ContainerOverrides = {}): AppContainer {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const redis = createRedisClient(env.REDIS_URL, 'hellogram-api');
  const events = new LocalEventPublisher();
  const clock = systemClock;

  const crypto = new NodeCryptoService(env.HASH_SECRET);
  const tokens = new JoseAccessTokenIssuer(env.JWT_ACCESS_SECRET);
  const limiter = new RedisRateLimiter(redis);
  const providerLog = logger.child({ component: 'dev-provider' });
  const sms =
    env.SMS_PROVIDER === 'msg91'
      ? new Msg91SmsProvider({
          authKey: env.MSG91_AUTH_KEY ?? '',
          otpTemplateId: env.MSG91_OTP_TEMPLATE_ID ?? '',
          noticeTemplateId: env.MSG91_NOTICE_TEMPLATE_ID ?? '',
        })
      : env.SMS_PROVIDER === 'none'
        ? new NoSmsProvider(providerLog)
        : new ConsoleSmsProvider(providerLog);
  const email = env.EMAIL_PROVIDER === 'smtp' ? new SmtpEmailProvider(env.SMTP_URL ?? '', env.EMAIL_FROM) : new ConsoleEmailProvider(providerLog);

  const repos = authRepos(prisma);
  if (env.OTP_BYPASS) logger.warn('OTP_BYPASS is ON — any 6-digit code is accepted (testing only)');
  const otp = new OtpVerifier(repos.otps, crypto, clock, { bypass: env.OTP_BYPASS });
  const proofs = new PhoneProofChecker({
    otp,
    firebase:
      overrides.phoneVerifier ??
      (env.PHONE_AUTH_PROVIDER === 'firebase' && env.FIREBASE_PROJECT_ID ? new FirebaseIdTokenVerifier(env.FIREBASE_PROJECT_ID) : null),
    clock,
  });

  const authService = new AuthService(
    { repos, uow: new PrismaUnitOfWork(prisma, authRepos), otp, sms, email, crypto, tokens, limiter, clock, events, proofs },
    { consentVersion: env.CONSENT_VERSION, sessionTtlDays: env.SESSION_TTL_DAYS },
  );
  const accountService = new AccountService({
    accounts: repos.accounts,
    sessions: repos.sessions,
    otp,
    email,
    crypto,
    limiter,
    clock,
    events,
  });

  const personas = new PrismaPersonaRepository(prisma);
  const personaService = new PersonaService({
    personas,
    crypto,
    clock,
    events,
    storage: new LocalDiskStorage(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL),
    qr: new QrCodeSvgRenderer(),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    codeDigits: env.CODE_DIGITS,
  });

  const reach = new PrismaReachRepository(prisma);
  const chatService = new ChatService({
    conversations: new PrismaConversationRepository(prisma),
    personas,
    reach,
    events,
    clock,
    limiter,
  });
  const blockService = new BlockService({
    blocks: new PrismaBlockRepository(prisma),
    clock,
    events,
    conversations: chatService.blockEffects(),
  });
  const requestRepos = (db: Db): RequestTxRepos => ({
    requests: new PrismaRequestRepository(db),
    conversations: new PrismaConversationBootstrapRepository(db),
  });
  const requestService = new RequestService({
    requests: new PrismaRequestRepository(prisma),
    personas,
    reach,
    uow: new PrismaUnitOfWork(prisma, requestRepos),
    blocks: blockService,
    events,
    clock,
  });

  const safetyService = new SafetyService({
    chat: chatService,
    blocks: blockService,
    reports: new PrismaReportRepository(prisma),
    requests: new PrismaRequestRepository(prisma),
    events,
    clock,
  });
  const pinService = new PinService({
    personas,
    pins: new PrismaPinRepository(prisma),
    accounts: repos.accounts,
    hasher: new Argon2PinHasher(),
    tokens: new RedisUnlockTokenStore(redis),
    otp,
    proofs,
    sms,
    crypto,
    limiter,
    events,
    clock,
  });
  const callService = new CallService({
    calls: new PrismaCallRepository(prisma),
    personas,
    reach,
    chat: chatService,
    lock: new RedisCallLock(redis),
    limiter,
    turn: new CoturnCredentialIssuer(env.TURN_URLS, env.TURN_SHARED_SECRET),
    events,
    clock,
  });
  callService.setTimeouts(new InProcessCallTimeouts((callId) => callService.timeout(callId)));
  const billingService = new BillingService({
    billing: new PrismaBillingRepository(prisma),
    provider:
      env.BILLING_PROVIDER === 'razorpay'
        ? new RazorpayBillingProvider({
            keyId: env.RAZORPAY_KEY_ID ?? '',
            keySecret: env.RAZORPAY_KEY_SECRET ?? '',
            webhookSecret: env.RAZORPAY_WEBHOOK_SECRET ?? '',
            planId: env.RAZORPAY_PLAN_ID ?? '',
          })
        : new DevBillingProvider(),
    personas,
    personaService,
    events,
    clock,
    limiter,
  });
  personaService.setCheckout(billingService);
  // Deleting a number keeps the subscription quantity in step (rule 5).
  events.subscribe('persona.retired', async (event) => {
    await billingService.reconcileAfterRetire((event.payload as { accountId: string }).accountId);
  });

  const notificationService = new NotificationService({
    subscriptions: new PrismaPushSubscriptionRepository(prisma),
    sender: null, // delivery happens in the worker
  });
  const pushTriggers = new PushTriggers({ personas, conversations: new PrismaConversationRepository(prisma), clock });
  const notificationQueue = new NotificationQueue(redis);

  const complianceService = new ComplianceService({
    lifecycle: new PrismaAccountLifecycleRepository(prisma),
    accounts: repos.accounts,
    grievances: new PrismaGrievanceRepository(prisma),
    audit: new PrismaAuditRepository(prisma),
    otp,
    proofs,
    sms,
    crypto,
    limiter,
    events,
    clock,
  });

  const maintenanceService = new MaintenanceService({ repo: new PrismaMaintenanceRepository(prisma), clock });

  const healthService = new HealthService(
    [new PostgresHealthProbe(prisma), new RedisHealthProbe(redis)],
    APP_VERSION,
  );

  return {
    redis,
    events,
    healthService,
    authService,
    accountService,
    personaService,
    requestService,
    blockService,
    chatService,
    safetyService,
    pinService,
    callService,
    billingService,
    notificationService,
    pushTriggers,
    notificationQueue,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    billingDevTools: env.BILLING_PROVIDER === 'dev' && env.NODE_ENV !== 'production',
    complianceService,
    phoneAuthProvider: env.PHONE_AUTH_PROVIDER,
    grievanceOfficer: { name: env.GRIEVANCE_OFFICER_NAME, email: env.GRIEVANCE_OFFICER_EMAIL },
    maintenanceService,
    avatarUrl: (key) => personaService.avatarUrl(key),
    mediaDir: env.MEDIA_DIR,
    ...(env.TURNSTILE_SECRET ? { turnstile: new TurnstileVerifier(env.TURNSTILE_SECRET) } : {}),
    trustProxy: env.TRUST_PROXY,
    cookie: { secure: env.COOKIE_SECURE ?? env.NODE_ENV === 'production', maxAgeDays: env.SESSION_TTL_DAYS },
    async close() {
      await notificationQueue.close().catch(() => undefined);
      await Promise.allSettled([prisma.$disconnect(), redis.quit()]);
    },
  };
}
