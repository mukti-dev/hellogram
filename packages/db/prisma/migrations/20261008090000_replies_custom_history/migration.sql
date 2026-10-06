-- AlterEnum
ALTER TYPE "Retention" ADD VALUE 'custom';

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "retentionMinutes" INTEGER;

-- AlterTable
ALTER TABLE "messages" ADD COLUMN     "replyToId" UUID;

-- CreateIndex
CREATE INDEX "messages_conversationId_expiredAt_createdAt_idx" ON "messages"("conversationId", "expiredAt", "createdAt");

-- CreateIndex
CREATE INDEX "messages_replyToId_idx" ON "messages"("replyToId");

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;

