-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('image', 'file');

-- CreateTable
CREATE TABLE "attachments" (
    "id" UUID NOT NULL,
    "conversationId" UUID NOT NULL,
    "uploaderPersonaId" UUID NOT NULL,
    "messageId" UUID,
    "kind" "AttachmentKind" NOT NULL,
    "mimeType" VARCHAR(100) NOT NULL,
    "fileName" VARCHAR(160) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "storageKey" VARCHAR(80) NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "attachments_messageId_key" ON "attachments"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "attachments_storageKey_key" ON "attachments"("storageKey");

-- CreateIndex
CREATE INDEX "attachments_createdAt_idx" ON "attachments"("createdAt");

-- AddForeignKey
ALTER TABLE "attachments" ADD CONSTRAINT "attachments_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("id") ON DELETE SET NULL ON UPDATE CASCADE;
