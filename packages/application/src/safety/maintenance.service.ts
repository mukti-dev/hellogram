import type { Clock, MaintenanceRepository } from '@hellogram/domain';
import { LIMITS } from '@hellogram/shared';

const DAY = 24 * 60 * 60 * 1000;

/** Scheduled clean-up use cases run by the worker (§10). */
export class MaintenanceService {
  constructor(private readonly deps: { repo: MaintenanceRepository; clock: Clock }) {}

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
