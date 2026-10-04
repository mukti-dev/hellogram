-- Phone push tokens for the mobile app (APNs VoIP / alert, FCM). Deleted with their session.

-- CreateEnum
CREATE TYPE "PushPlatform" AS ENUM ('ios', 'android');

-- CreateEnum
CREATE TYPE "PushTokenKind" AS ENUM ('voip', 'alert');

-- CreateTable
CREATE TABLE "native_push_tokens" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "sessionId" UUID NOT NULL,
    "platform" "PushPlatform" NOT NULL,
    "kind" "PushTokenKind" NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "native_push_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "native_push_tokens_token_key" ON "native_push_tokens"("token");

-- CreateIndex
CREATE INDEX "native_push_tokens_accountId_idx" ON "native_push_tokens"("accountId");

-- AddForeignKey
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "native_push_tokens" ADD CONSTRAINT "native_push_tokens_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

