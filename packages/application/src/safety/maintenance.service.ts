import type { AttachmentRepository, BlobStore, Clock, MaintenanceRepository, StorageProvider } from '@hellogram/domain';
import { LIMITS } from '@hellogram/shared';
import { discardAttachment } from '../chat/attachment.service.js';

const DAY = 24 * 60 * 60 * 1000;
const UNSENT_UPLOAD_TTL_MS = 60 * 60 * 1000;

/** Scheduled clean-up use cases run by the worker (§10). */
export class MaintenanceService {
  constructor(
    private readonly deps: {
      repo: MaintenanceRepository;
      attachments: AttachmentRepository;
      blobs: BlobStore;
      storage: StorageProvider;
      clock: Clock;
    },
  ) {}

  /**
   * Destroys stored files that no longer belong to a live message: uploads never sent (after an hour),
   * and files whose message content was erased (30 days after delete for everyone or expiry).
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

  /** Rule 22: hides messages past their chat's retention. They are erased SOFT_DELETE_DAYS later. */
  expireContent() {
    return this.deps.repo.expireContent(this.deps.clock.now());
  }

  /** Permanently erases messages deleted for everyone or expired more than SOFT_DELETE_DAYS ago. */
  eraseDeletedContent() {
    const now = this.deps.clock.now();
    return this.deps.repo.eraseDeletedContent(this.softDeleteCutoff(), now);
  }

  /** Permanently destroys profile photos that were replaced or removed more than SOFT_DELETE_DAYS ago. */
  purgeTrashedFiles() {
    return this.deps.storage.purgeTrash(this.softDeleteCutoff());
  }

  private softDeleteCutoff() {
    return new Date(this.deps.clock.now().getTime() - LIMITS.SOFT_DELETE_DAYS * DAY);
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
