import type { AttachmentRepository, BlobStore, Clock, MaintenanceRepository } from '@hellogram/domain';
import { LIMITS } from '@hellogram/shared';
import { discardAttachment } from '../chat/attachment.service.js';

const DAY = 24 * 60 * 60 * 1000;
const UNSENT_UPLOAD_TTL_MS = 60 * 60 * 1000;

/** Scheduled clean-up use cases run by the worker (§10). */
export class MaintenanceService {
  constructor(
    private readonly deps: { repo: MaintenanceRepository; attachments: AttachmentRepository; blobs: BlobStore; clock: Clock },
  ) {}

  /**
   * Destroys stored files that no longer belong to a live message: uploads never sent (after an hour),
   * and files whose message was deleted for everyone, expired under the chat's retention, or purged.
   */
  async sweepAttachments(): Promise<number> {
    const unsentBefore = new Date(this.deps.clock.now().getTime() - UNSENT_UPLOAD_TTL_MS);
    let removed = 0;
    for (let batch = 0; batch < 20; batch += 1) {
      const rows = await this.deps.attachments.listDisposable(unsentBefore, 200);
      if (rows.length === 0) break;
      let failed = 0;
      for (const row of rows) {
        await discardAttachment(this.deps, row).then(
          () => (removed += 1),
          () => (failed += 1),
        );
      }
      // Storage is down: stop, the rows stay and the next run retries.
      if (failed === rows.length) break;
    }
    return removed;
  }

  purgeExpiredContent() {
    return this.deps.repo.purgeExpiredContent(this.deps.clock.now());
  }

  purgeOldMetadata() {
    return this.deps.repo.purgeOldMetadata(new Date(this.deps.clock.now().getTime() - LIMITS.METADATA_RETENTION_DAYS * DAY));
  }

  purgeClosedReportEvidence() {
    return this.deps.repo.purgeClosedReportEvidence(
      new Date(this.deps.clock.now().getTime() - LIMITS.METADATA_RETENTION_DAYS * DAY),
    );
  }

  expireRequests() {
    return this.deps.repo.expireRequests(this.deps.clock.now());
  }

  cleanupAuth() {
    return this.deps.repo.cleanupAuth(this.deps.clock.now());
  }
}
