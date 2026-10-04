-- Soft delete: deleted and expired messages keep their content for 30 days (admins can still see it in
-- reports), then the worker erases it. Account deletion waits 30 days and is undone by logging in.

ALTER TYPE "AccountStatus" ADD VALUE 'pending_deletion' BEFORE 'deleted';

ALTER TABLE "messages" ADD COLUMN "expiredAt" TIMESTAMPTZ;

-- Messages deleted before this change already lost their text: mark them erased, so their files are swept.
UPDATE "messages" SET "contentPurgedAt" = "deletedForEveryoneAt"
 WHERE "deletedForEveryoneAt" IS NOT NULL AND "contentPurgedAt" IS NULL;

