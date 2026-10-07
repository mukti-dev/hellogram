import {
  BillingService,
  CallService,
  ChatService,
  ComplianceService,
  MaintenanceService,
  OtpVerifier,
  PhoneProofChecker,
  NotificationService,
  PersonaService,
  PushTriggers,
} from '@hellogram/application';
import { createPrismaClient } from '@hellogram/db';
import { systemClock } from '@hellogram/domain';
import {
  ConsoleSmsProvider,
  CoturnCredentialIssuer,
  PrismaAccountLifecycleRepository,
  PrismaAccountRepository,
  PrismaAttachmentRepository,
  PrismaAuditRepository,
  createAttachmentStorage,
  PrismaGrievanceRepository,
  PrismaOtpChallengeRepository,
  DevBillingProvider,
  DisabledBillingProvider,
  LocalDiskStorage,
  LocalEventPublisher,
  NodeCryptoService,
  PrismaBillingRepository,
  PrismaCallRepository,
  PrismaConversationRepository,
  PrismaMaintenanceRepository,
  PrismaPersonaRepository,
  PrismaNativePushTokenRepository,
  FcmSender,
  parseServiceAccount,
  PrismaPushSubscriptionRepository,
  PrismaReachRepository,
  QrCodeSvgRenderer,
  RazorpayBillingProvider,
  RedisCallLock,
  RedisRateLimiter,
  WebPushSender,
  type Redis,
} from '@hellogram/infrastructure';
import type { WorkerEnv } from './env.js';

/** Worker composition root: same application services as the API. */
export function createWorkerContainer(env: WorkerEnv, redis: Redis) {
  const prisma = createPrismaClient(env.DATABASE_URL);
  const clock = systemClock;
  const events = new LocalEventPublisher();
  const limiter = new RedisRateLimiter(redis);
  const personas = new PrismaPersonaRepository(prisma);
  const conversations = new PrismaConversationRepository(prisma);
  const reach = new PrismaReachRepository(prisma);
  const attachments = new PrismaAttachmentRepository(prisma);
  const { blobs } = createAttachmentStorage(env);
  const chat = new ChatService({ conversations, personas, reach, events, clock, limiter });
  const mediaStorage = new LocalDiskStorage(env.MEDIA_DIR, '/media');
  const calls = new CallService({
    calls: new PrismaCallRepository(prisma),
    personas,
    reach,
    chat,
    lock: new RedisCallLock(redis),
    turn: new CoturnCredentialIssuer([], 'unused-in-worker'),
    events,
    clock,
  });
  const personaService = new PersonaService({
    personas,
    // Only createWithUniqueCode is used here; the rest are unused in the worker.
    crypto: new NodeCryptoService('worker-unused-secret-0123456789abcdef'),
    clock,
    events,
    storage: mediaStorage,
    qr: new QrCodeSvgRenderer(),
    publicBaseUrl: env.PUBLIC_BASE_URL,
    codeDigits: env.CODE_DIGITS,
  });
  const billing = new BillingService({
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
  const notifications = new NotificationService({
    subscriptions: new PrismaPushSubscriptionRepository(prisma),
    nativeTokens: new PrismaNativePushTokenRepository(prisma),
    clock,
    sender:
      env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY
        ? new WebPushSender({ subject: env.VAPID_SUBJECT, publicKey: env.VAPID_PUBLIC_KEY, privateKey: env.VAPID_PRIVATE_KEY })
        : null,
    // Firebase (FCM) for the mobile app; until the key is set, phone tokens are only stored.
    nativeSender: env.FCM_SERVICE_ACCOUNT ? new FcmSender(parseServiceAccount(env.FCM_SERVICE_ACCOUNT)) : null,
  });
  const triggers = new PushTriggers({ personas, conversations, clock });
  const maintenance = new MaintenanceService({
    repo: new PrismaMaintenanceRepository(prisma),
    attachments,
    blobs,
    storage: mediaStorage,
    clock,
  });
  const crypto = new NodeCryptoService('worker-unused-secret-0123456789abcdef');
  const quiet = { info: () => undefined };
  // Only applyDuePhoneChanges and eraseDueAccounts run in the worker.
  const workerOtp = new OtpVerifier(new PrismaOtpChallengeRepository(prisma), crypto, clock, { bypass: false });
  const compliance = new ComplianceService({
    lifecycle: new PrismaAccountLifecycleRepository(prisma),
    accounts: new PrismaAccountRepository(prisma),
    grievances: new PrismaGrievanceRepository(prisma),
    audit: new PrismaAuditRepository(prisma),
    otp: workerOtp,
    proofs: new PhoneProofChecker({ otp: workerOtp, firebase: null, clock }),
    sms: new ConsoleSmsProvider(quiet),
    storage: mediaStorage,
    crypto,
    limiter,
    events,
    clock,
  });
  return {
    maintenance,
    compliance,
    calls,
    billing,
    notifications,
    triggers,
    close: () => prisma.$disconnect(),
  };
}

export type WorkerContainer = ReturnType<typeof createWorkerContainer>;
