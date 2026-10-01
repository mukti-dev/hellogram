-- AlterTable
ALTER TABLE "persona_drafts" ADD COLUMN     "consumedPersonaId" UUID;

-- CreateIndex
CREATE INDEX "persona_drafts_providerRef_idx" ON "persona_drafts"("providerRef");

-- Gap-free, concurrency-safe invoice numbering (HG/<FY>/<seq>).
CREATE SEQUENCE IF NOT EXISTS invoice_seq START 1;
