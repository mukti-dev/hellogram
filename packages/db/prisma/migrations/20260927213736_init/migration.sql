-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'banned', 'deleted');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('sms', 'email');

-- CreateEnum
CREATE TYPE "OtpPurpose" AS ENUM ('login', 'email_login', 'email_verify', 'pin_reset', 'phone_change', 'account_delete');

-- CreateEnum
CREATE TYPE "PersonaStatus" AS ENUM ('active', 'paused', 'retired');

-- CreateEnum
CREATE TYPE "PauseReason" AS ENUM ('user', 'billing', 'admin');

-- CreateEnum
CREATE TYPE "LabelKind" AS ENUM ('olx', 'dating', 'tenants', 'other');

-- CreateEnum
CREATE TYPE "Retention" AS ENUM ('forever', 'd90', 'd30', 'd7', 'h24');

-- CreateEnum
CREATE TYPE "RequestStatus" AS ENUM ('pending', 'accepted', 'declined', 'blocked', 'expired');

-- CreateEnum
CREATE TYPE "MessageType" AS ENUM ('text', 'system');

-- CreateEnum
CREATE TYPE "CallStatus" AS ENUM ('ringing', 'answered', 'missed', 'declined', 'ended', 'failed');

-- CreateEnum
CREATE TYPE "CallEndReason" AS ENUM ('completed', 'no_answer', 'busy', 'declined', 'cancelled', 'network_error', 'suppressed');

-- CreateEnum
CREATE TYPE "ReportReason" AS ENUM ('harassment', 'spam', 'scam', 'sexual_content', 'threat', 'other');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('open', 'reviewing', 'actioned', 'dismissed');

-- CreateEnum
CREATE TYPE "SubStatus" AS ENUM ('created', 'authenticated', 'active', 'past_due', 'grace', 'cancelled', 'completed');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('moderator', 'admin', 'grievance_officer');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('system', 'admin', 'account');

-- CreateEnum
CREATE TYPE "AccountAction" AS ENUM ('warn', 'suspend', 'unsuspend', 'ban', 'unban');

-- CreateEnum
CREATE TYPE "GrievanceStatus" AS ENUM ('open', 'acknowledged', 'resolved', 'closed');

-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('pending', 'ready', 'expired', 'failed');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ,
    "ageConfirmedAt" TIMESTAMPTZ NOT NULL,
    "status" "AccountStatus" NOT NULL DEFAULT 'active',
    "suspendedUntil" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "deletedAt" TIMESTAMPTZ,

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consent_records" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "acceptedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ipHash" TEXT,

    CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "phone_changes" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "newPhone" TEXT NOT NULL,
    "verifiedAt" TIMESTAMPTZ NOT NULL,
    "effectiveAt" TIMESTAMPTZ NOT NULL,
    "completedAt" TIMESTAMPTZ,
    "cancelledAt" TIMESTAMPTZ,

    CONSTRAINT "phone_changes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceName" TEXT,
    "userAgent" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "revokedAt" TIMESTAMPTZ,
    "revokeReason" TEXT,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usedAt" TIMESTAMPTZ,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_challenges" (
    "id" UUID NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "targetHash" TEXT NOT NULL,
    "purpose" "OtpPurpose" NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,
    "ipHash" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personas" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "code" VARCHAR(9) NOT NULL,
    "displayName" VARCHAR(40) NOT NULL,
    "avatarKey" TEXT,
    "labelKind" "LabelKind" NOT NULL DEFAULT 'other',
    "labelText" VARCHAR(16),
    "status" "PersonaStatus" NOT NULL DEFAULT 'active',
    "pauseReason" "PauseReason",
    "isPaid" BOOLEAN NOT NULL DEFAULT false,
    "acceptRequests" BOOLEAN NOT NULL DEFAULT true,
    "allowCalls" BOOLEAN NOT NULL DEFAULT true,
    "readReceipts" BOOLEAN NOT NULL DEFAULT true,
    "dndUntil" TIMESTAMPTZ,
    "defaultRetention" "Retention" NOT NULL DEFAULT 'd30',
    "pinHash" TEXT,
    "pinFailedCount" INTEGER NOT NULL DEFAULT 0,
    "pinLockLevel" INTEGER NOT NULL DEFAULT 0,
    "pinLockedUntil" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "retiredAt" TIMESTAMPTZ,

    CONSTRAINT "personas_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "retired_codes" (
    "code" VARCHAR(9) NOT NULL,
    "retiredAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "retired_codes_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "persona_drafts" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "displayName" VARCHAR(40) NOT NULL,
    "labelKind" "LabelKind" NOT NULL,
    "labelText" VARCHAR(16),
    "allowCalls" BOOLEAN NOT NULL DEFAULT true,
    "providerRef" TEXT,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "consumedAt" TIMESTAMPTZ,

    CONSTRAINT "persona_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_requests" (
    "id" UUID NOT NULL,
    "fromPersonaId" UUID NOT NULL,
    "toPersonaId" UUID NOT NULL,
    "introMessage" VARCHAR(300) NOT NULL,
    "status" "RequestStatus" NOT NULL DEFAULT 'pending',
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMPTZ,
    "expiresAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contact_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" UUID NOT NULL,
    "personaAId" UUID NOT NULL,
    "personaBId" UUID NOT NULL,
    "retention" "Retention" NOT NULL,
    "retentionChangedById" UUID,
    "retentionChangedAt" TIMESTAMPTZ,
    "lastMessageAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_members" (
    "conversationId" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "nickname" VARCHAR(40),
    "clearedBefore" TIMESTAMPTZ,
    "mutedUntil" TIMESTAMPTZ,
    "lastReadMessageId" UUID,
    "lastDeliveredMessageId" UUID,
    "hiddenAt" TIMESTAMPTZ,
    "counterpartMasked" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "conversation_members_pkey" PRIMARY KEY ("conversationId","personaId")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "senderPersonaId" UUID NOT NULL,
    "clientMessageId" VARCHAR(64) NOT NULL,
    "type" "MessageType" NOT NULL DEFAULT 'text',
    "body" VARCHAR(4000),
    "systemPayload" JSONB,
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMPTZ,
    "readAt" TIMESTAMPTZ,
    "deletedForEveryoneAt" TIMESTAMPTZ,
    "contentPurgedAt" TIMESTAMPTZ,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_hides" (
    "messageId" UUID NOT NULL,
    "personaId" UUID NOT NULL,
    "hiddenAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_hides_pkey" PRIMARY KEY ("messageId","personaId")
);

-- CreateTable
CREATE TABLE "calls" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "callerPersonaId" UUID NOT NULL,
    "calleePersonaId" UUID NOT NULL,
    "status" "CallStatus" NOT NULL DEFAULT 'ringing',
    "endReason" "CallEndReason",
    "suppressed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMPTZ,
    "endedAt" TIMESTAMPTZ,

    CONSTRAINT "calls_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blocks" (
    "id" UUID NOT NULL,
    "blockerAccountId" UUID NOT NULL,
    "blockedAccountId" UUID NOT NULL,
    "blockerPersonaId" UUID NOT NULL,
    "blockedPersonaId" UUID NOT NULL,
    "conversationId" UUID,
    "requestId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blocks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporterPersonaId" UUID NOT NULL,
    "reportedPersonaId" UUID NOT NULL,
    "conversationId" UUID,
    "requestId" UUID,
    "reason" "ReportReason" NOT NULL,
    "note" VARCHAR(1000),
    "alsoBlocked" BOOLEAN NOT NULL DEFAULT true,
    "status" "ReportStatus" NOT NULL DEFAULT 'open',
    "handledByAdminId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMPTZ,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_evidence" (
    "id" UUID NOT NULL,
    "reportId" UUID NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "report_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'razorpay',
    "providerSubId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "status" "SubStatus" NOT NULL,
    "currentPeriodEnd" TIMESTAMPTZ,
    "graceUntil" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "amountPaise" INTEGER NOT NULL,
    "gstPaise" INTEGER NOT NULL,
    "invoiceNo" TEXT NOT NULL,
    "providerPaymentId" TEXT NOT NULL,
    "paidAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMPTZ,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscriptions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sessionId" UUID,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "data_exports" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "status" "ExportStatus" NOT NULL DEFAULT 'pending',
    "s3Key" TEXT,
    "expiresAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "totpSecret" TEXT NOT NULL,
    "disabledAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_actions" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "adminId" UUID NOT NULL,
    "action" "AccountAction" NOT NULL,
    "reason" TEXT NOT NULL,
    "until" TIMESTAMPTZ,
    "reportId" UUID,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_actions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "actorType" "ActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "grievance_tickets" (
    "id" UUID NOT NULL,
    "complainantContact" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "GrievanceStatus" NOT NULL DEFAULT 'open',
    "ackDueAt" TIMESTAMPTZ NOT NULL,
    "resolveDueAt" TIMESTAMPTZ NOT NULL,
    "ackAt" TIMESTAMPTZ,
    "resolvedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "grievance_tickets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "legal_requests" (
    "id" UUID NOT NULL,
    "authority" TEXT NOT NULL,
    "referenceNo" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "receivedAt" TIMESTAMPTZ NOT NULL,
    "respondedAt" TIMESTAMPTZ,
    "handledById" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "legal_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_phone_key" ON "accounts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "consent_records_accountId_idx" ON "consent_records"("accountId");

-- CreateIndex
CREATE INDEX "phone_changes_accountId_idx" ON "phone_changes"("accountId");

-- CreateIndex
CREATE INDEX "sessions_accountId_idx" ON "sessions"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_sessionId_idx" ON "refresh_tokens"("sessionId");

-- CreateIndex
CREATE INDEX "otp_challenges_targetHash_purpose_createdAt_idx" ON "otp_challenges"("targetHash", "purpose", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "personas_code_key" ON "personas"("code");

-- CreateIndex
CREATE INDEX "personas_accountId_status_idx" ON "personas"("accountId", "status");

-- CreateIndex
CREATE INDEX "persona_drafts_accountId_idx" ON "persona_drafts"("accountId");

-- CreateIndex
CREATE INDEX "contact_requests_toPersonaId_status_createdAt_idx" ON "contact_requests"("toPersonaId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "contact_requests_fromPersonaId_toPersonaId_createdAt_idx" ON "contact_requests"("fromPersonaId", "toPersonaId", "createdAt");

-- CreateIndex
CREATE INDEX "conversations_personaBId_idx" ON "conversations"("personaBId");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_personaAId_personaBId_key" ON "conversations"("personaAId", "personaBId");

-- CreateIndex
CREATE INDEX "conversation_members_personaId_idx" ON "conversation_members"("personaId");

-- CreateIndex
CREATE INDEX "messages_conversationId_createdAt_idx" ON "messages"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "messages_createdAt_idx" ON "messages"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "messages_senderPersonaId_clientMessageId_key" ON "messages"("senderPersonaId", "clientMessageId");

-- CreateIndex
CREATE INDEX "calls_conversationId_idx" ON "calls"("conversationId");

-- CreateIndex
CREATE INDEX "calls_callerPersonaId_createdAt_idx" ON "calls"("callerPersonaId", "createdAt");

-- CreateIndex
CREATE INDEX "calls_calleePersonaId_createdAt_idx" ON "calls"("calleePersonaId", "createdAt");

-- CreateIndex
CREATE INDEX "calls_createdAt_idx" ON "calls"("createdAt");

-- CreateIndex
CREATE INDEX "blocks_blockerAccountId_blockedAccountId_idx" ON "blocks"("blockerAccountId", "blockedAccountId");

-- CreateIndex
CREATE INDEX "blocks_blockedAccountId_blockerAccountId_idx" ON "blocks"("blockedAccountId", "blockerAccountId");

-- CreateIndex
CREATE INDEX "blocks_blockedPersonaId_idx" ON "blocks"("blockedPersonaId");

-- CreateIndex
CREATE UNIQUE INDEX "blocks_blockerPersonaId_blockedPersonaId_key" ON "blocks"("blockerPersonaId", "blockedPersonaId");

-- CreateIndex
CREATE INDEX "reports_status_createdAt_idx" ON "reports"("status", "createdAt");

-- CreateIndex
CREATE INDEX "reports_reporterPersonaId_idx" ON "reports"("reporterPersonaId");

-- CreateIndex
CREATE INDEX "reports_reportedPersonaId_idx" ON "reports"("reportedPersonaId");

-- CreateIndex
CREATE UNIQUE INDEX "report_evidence_reportId_key" ON "report_evidence"("reportId");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_providerSubId_key" ON "subscriptions"("providerSubId");

-- CreateIndex
CREATE INDEX "subscriptions_accountId_status_idx" ON "subscriptions"("accountId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "payments_invoiceNo_key" ON "payments"("invoiceNo");

-- CreateIndex
CREATE UNIQUE INDEX "payments_providerPaymentId_key" ON "payments"("providerPaymentId");

-- CreateIndex
CREATE INDEX "payments_subscriptionId_idx" ON "payments"("subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscriptions_endpoint_key" ON "push_subscriptions"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscriptions_accountId_idx" ON "push_subscriptions"("accountId");

-- CreateIndex
CREATE INDEX "data_exports_accountId_idx" ON "data_exports"("accountId");

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "admin_users"("email");

-- CreateIndex
CREATE INDEX "account_actions_accountId_idx" ON "account_actions"("accountId");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE INDEX "grievance_tickets_status_ackDueAt_idx" ON "grievance_tickets"("status", "ackDueAt");

-- AddForeignKey
ALTER TABLE "consent_records" ADD CONSTRAINT "consent_records_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "phone_changes" ADD CONSTRAINT "phone_changes_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personas" ADD CONSTRAINT "personas_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "persona_drafts" ADD CONSTRAINT "persona_drafts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_fromPersonaId_fkey" FOREIGN KEY ("fromPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contact_requests" ADD CONSTRAINT "contact_requests_toPersonaId_fkey" FOREIGN KEY ("toPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_personaAId_fkey" FOREIGN KEY ("personaAId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_personaBId_fkey" FOREIGN KEY ("personaBId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_personaId_fkey" FOREIGN KEY ("personaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_senderPersonaId_fkey" FOREIGN KEY ("senderPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_hides" ADD CONSTRAINT "message_hides_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_callerPersonaId_fkey" FOREIGN KEY ("callerPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_calleePersonaId_fkey" FOREIGN KEY ("calleePersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerAccountId_fkey" FOREIGN KEY ("blockerAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedAccountId_fkey" FOREIGN KEY ("blockedAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockerPersonaId_fkey" FOREIGN KEY ("blockerPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blockedPersonaId_fkey" FOREIGN KEY ("blockedPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporterPersonaId_fkey" FOREIGN KEY ("reporterPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reportedPersonaId_fkey" FOREIGN KEY ("reportedPersonaId") REFERENCES "personas"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_evidence" ADD CONSTRAINT "report_evidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_actions" ADD CONSTRAINT "account_actions_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
