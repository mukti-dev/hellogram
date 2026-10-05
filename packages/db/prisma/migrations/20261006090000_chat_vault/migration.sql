-- CreateEnum
CREATE TYPE "VaultState" AS ENUM ('archived', 'locked', 'hidden');

-- AlterTable
ALTER TABLE "conversation_members" ADD COLUMN     "vault" "VaultState",
ADD COLUMN     "vaultSpaceId" UUID;

-- CreateTable
CREATE TABLE "chat_vaults" (
    "accountId" UUID NOT NULL,
    "lockPinHash" TEXT,
    "lockFailedCount" INTEGER NOT NULL DEFAULT 0,
    "lockLockLevel" INTEGER NOT NULL DEFAULT 0,
    "lockLockedUntil" TIMESTAMPTZ,
    "hideFailedCount" INTEGER NOT NULL DEFAULT 0,
    "hideLockLevel" INTEGER NOT NULL DEFAULT 0,
    "hideLockedUntil" TIMESTAMPTZ,

    CONSTRAINT "chat_vaults_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "vault_spaces" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "pinHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vault_spaces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vault_spaces_accountId_idx" ON "vault_spaces"("accountId");

-- CreateIndex
CREATE INDEX "conversation_members_vaultSpaceId_idx" ON "conversation_members"("vaultSpaceId");

-- AddForeignKey
ALTER TABLE "conversation_members" ADD CONSTRAINT "conversation_members_vaultSpaceId_fkey" FOREIGN KEY ("vaultSpaceId") REFERENCES "vault_spaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_vaults" ADD CONSTRAINT "chat_vaults_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vault_spaces" ADD CONSTRAINT "vault_spaces_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
