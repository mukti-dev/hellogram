-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('male', 'female', 'other', 'prefer_not_to_say');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "OtpPurpose" ADD VALUE 'signup';
ALTER TYPE "OtpPurpose" ADD VALUE 'device_login';
ALTER TYPE "OtpPurpose" ADD VALUE 'password_reset';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "gender" "Gender",
ADD COLUMN     "passwordHash" TEXT;

-- AlterTable
ALTER TABLE "sessions" ADD COLUMN     "deviceHash" TEXT;

-- CreateTable
CREATE TABLE "trusted_devices" (
    "id" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "deviceHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trusted_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "trusted_devices_accountId_deviceHash_key" ON "trusted_devices"("accountId", "deviceHash");

-- AddForeignKey
ALTER TABLE "trusted_devices" ADD CONSTRAINT "trusted_devices_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
