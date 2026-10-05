import {
  AccountService,
  AuthService,
  BillingService,
  BlockService,
  CallService,
  AttachmentService,
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
  VaultService,
  RequestService,
  type RequestTxRepos,
} from '@hellogram/application';
import { createPrismaClient } from '@hellogram/db';
import { systemClock, type AuthRepositories, type BlobStore, type HostedSmsVerification, type PendingDeviceLogin, type PendingSignup, type PhoneIdentityVerifier } from '@hellogram/domain';
import {
  ConsoleEmailProvider,
  DisabledEmailProvider,
  ConsoleSmsProvider,
  Argon2PasswordHasher,
  Argon2PinHasher,
  DevBillingProvider,
  DisabledBillingProvider,
  FirebaseIdTokenVerifier,
  NoSmsProvider,
  NotificationQueue,
  PrismaAccountLifecycleRepository,
  PrismaAttachmentRepository,
  PrismaAuditRepository,
  createAttachmentStorage,
  PrismaBillingRepository,
  PrismaGrievanceRepository,
  PrismaNativePushTokenRepository,
  PrismaPushSubscriptionRepository,
  RazorpayBillingProvider,
  CoturnCredentialIssuer,
  InProcessCallTimeouts,
  PrismaCallRepository,
  RedisCallLock,
  JoseAccessTokenIssuer,
  Msg91SmsProvider,
  Fast2SmsProvider,
  MessageCentralVerification,
  TwoFactorVerification,
  SmtpEmailProvider,
  TurnstileVerifier,
  PrismaPinRepository,
  PrismaVaultRepository,
  RedisEphemeralStore,
  RedisUnlockTokenStore,
  RedisVaultTokenStore,
  PrismaTrustedDeviceRepository,
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
  attachmentService: AttachmentService;
  safetyService: SafetyService;
  pinService: PinService;
  vaultService: VaultService;
  callService: CallService;
  billingService: BillingService;
  notificationService: NotificationService;
  pushTriggers: PushTriggers;
  notificationQueue?: NotificationQueue;
  vapidPublicKey?: string | undefined;
  billingDevTools: boolean;
  phoneAuthProvider: 'otp' | 'firebase';
  /** How codes reach the phone; the web app warns about a possible call for 'call_or_sms'. */
  otpDelivery: 'sms' | 'call_or_sms';
  /** The Terms/Privacy version sign-up must accept. */
  consentVersion: string;
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
  trustedDevices: new PrismaTrustedDeviceRepository(db),
});

export interface ContainerOverrides {
  /** Tests: stand-in for Firebase token verification. */
  phoneVerifier?: PhoneIdentityVerifier;
  /** Tests: stand-in for S3. */
  blobs?: BlobStore;
  /** Tests: stand-in for Message Central. */
  hostedSms?: HostedSmsVerification;
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
      : env.SMS_PROVIDER === 'fast2sms'
        ? new Fast2SmsProvider(
            { apiKey: env.FAST2SMS_API_KEY ?? '', route: env.FAST2SMS_ROUTE, otpTemplateId: env.FAST2SMS_OTP_TEMPLATE_ID },
            logger.child({ component: 'fast2sms' }),
          )
      : env.SMS_PROVIDER === 'none' || env.SMS_PROVIDER === 'messagecentral' || env.SMS_PROVIDER === 'twofactor'
        ? new NoSmsProvider(providerLog)
        : new ConsoleSmsProvider(providerLog);
  const hosted =
    overrides.hostedSms ??
    (env.SMS_PROVIDER === 'twofactor'
      ? new TwoFactorVerification(
          { apiKey: env.TWOFACTOR_API_KEY ?? '', templateName: env.TWOFACTOR_OTP_TEMPLATE },
          logger.child({ component: 'twofactor' }),
        )
      : env.SMS_PROVIDER === 'messagecentral'
        ? new MessageCentralVerification(
          {
            customerId: env.MESSAGECENTRAL_CUSTOMER_ID ?? '',
            authToken: env.MESSAGECENTRAL_AUTH_TOKEN,
            password: env.MESSAGECENTRAL_PASSWORD,
            email: env.MESSAGECENTRAL_EMAIL,
          },
          logger.child({ component: 'messagecentral' }),
        )
        : null);
  const email =
    env.EMAIL_PROVIDER === 'smtp'
      ? new SmtpEmailProvider(env.SMTP_URL ?? '', env.EMAIL_FROM)
      : env.EMAIL_PROVIDER === 'none'
        ? new DisabledEmailProvider()
        : new ConsoleEmailProvider(providerLog);

  const repos = authRepos(prisma);
  if (env.OTP_BYPASS) logger.warn('OTP_BYPASS is ON — any 6-digit code is accepted (testing only)');
  const otp = new OtpVerifier(repos.otps, crypto, clock, { bypass: env.OTP_BYPASS, sms, hosted });
  const proofs = new PhoneProofChecker({
    otp,
    firebase:
      overrides.phoneVerifier ??
      (env.PHONE_AUTH_PROVIDER === 'firebase' && env.FIREBASE_PROJECT_ID ? new FirebaseIdTokenVerifier(env.FIREBASE_PROJECT_ID) : null),
    clock,
  });

  const authService = new AuthService(
    {
      repos,
      uow: new PrismaUnitOfWork(prisma, authRepos),
      otp,
      proofs,
      passwords: new Argon2PasswordHasher(),
      pendingSignups: new RedisEphemeralStore<PendingSignup>(redis, 'signup'),
      deviceLogins: new RedisEphemeralStore<PendingDeviceLogin>(redis, 'device-login'),
      crypto,
      tokens,
      limiter,
      clock,
      events,
    },
    { consentVersion: env.CONSENT_VERSION, sessionTtlDays: env.SESSION_TTL_DAYS, phoneAuth: env.PHONE_AUTH_PROVIDER },
  );
  const accountService = new AccountService({
    accounts: repos.accounts,
    sessions: repos.sessions,
    trustedDevices: repos.trustedDevices,
    otp,
    email,
    crypto,
    limiter,
    clock,
    events,
  });

  const personas = new PrismaPersonaRepository(prisma);
  const mediaStorage = new LocalDiskStorage(env.MEDIA_DIR, env.MEDIA_PUBLIC_URL);
  const personaService = new PersonaService({
    personas,
    crypto,
    clock,
    events,
    storage: mediaStorage,
    qr: new QrCodeSvgRenderer(),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    codeDigits: env.CODE_DIGITS,
  });

  const reach = new PrismaReachRepository(prisma);
  const conversations = new PrismaConversationRepository(prisma);
  const attachments = new PrismaAttachmentRepository(prisma);
  const attachmentStorage = createAttachmentStorage(env);
  const blobs = overrides.blobs ?? attachmentStorage.blobs;
  const chatService = new ChatService({
    conversations,
    personas,
    reach,
    events,
    clock,
    limiter,
  });
  const attachmentService = new AttachmentService({
    attachments,
    blobs,
    cipher: attachmentStorage.cipher,
    conversations,
    chat: chatService,
    crypto,
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
  const vaultService = new VaultService({
    vault: new PrismaVaultRepository(prisma),
    conversations,
    personas,
    accounts: repos.accounts,
    hasher: new Argon2PinHasher(),
    tokens: new RedisVaultTokenStore(redis),
    otp,
    proofs,
    limiter,
    crypto,
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
    crypto,
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
        : env.BILLING_PROVIDER === 'none'
          ? new DisabledBillingProvider()
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
    nativeTokens: new PrismaNativePushTokenRepository(prisma),
    clock,
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
    storage: mediaStorage,
    crypto,
    limiter,
    events,
    clock,
  });

  const maintenanceService = new MaintenanceService({
    repo: new PrismaMaintenanceRepository(prisma),
    attachments,
    blobs,
    storage: mediaStorage,
    clock,
  });

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
    attachmentService,
    safetyService,
    pinService,
    vaultService,
    callService,
    billingService,
    notificationService,
    pushTriggers,
    notificationQueue,
    vapidPublicKey: env.VAPID_PUBLIC_KEY,
    billingDevTools: env.BILLING_PROVIDER === 'dev' && env.NODE_ENV !== 'production',
    complianceService,
    phoneAuthProvider: env.PHONE_AUTH_PROVIDER,
    // 2Factor reads the code out in a voice call when it can't send an SMS.
    consentVersion: env.CONSENT_VERSION,
    otpDelivery: env.PHONE_AUTH_PROVIDER === 'otp' && env.SMS_PROVIDER === 'twofactor' ? 'call_or_sms' : 'sms',
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
