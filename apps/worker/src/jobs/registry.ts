import type { Job } from 'bullmq';
import type { Logger } from 'pino';
import type { WorkerContainer } from '../container.js';

/**
 * Job handlers are thin: they call an application service (the same services the API uses).
 * docs/ARCHITECTURE.md §10.
 */
export type JobHandler = (job: Job, logger: Logger, c: WorkerContainer) => Promise<void>;

export const QUEUES = {
  maintenance: 'maintenance',
  notify: 'notify',
} as const;

export interface RepeatableJob {
  queue: 'maintenance';
  name: string;
  every: number;
}

const MIN = 60_000;

export const handlers: Record<string, Record<string, JobHandler>> = {
  [QUEUES.maintenance]: {
    'retention.purgeContent': async (_job, logger, c) => {
      const purged = await c.maintenance.purgeExpiredContent();
      if (purged) logger.info({ purged }, 'message content purged');
    },
    'retention.purgeMetadata': async (_job, logger, c) => {
      logger.info(await c.maintenance.purgeOldMetadata(), 'old metadata purged');
    },
    'reports.purgeEvidence': async (_job, logger, c) => {
      logger.info({ purged: await c.maintenance.purgeClosedReportEvidence() }, 'closed report evidence purged');
    },
    'requests.expire': async (_job, logger, c) => {
      const expired = await c.maintenance.expireRequests();
      if (expired) logger.info({ expired }, 'requests expired');
    },
    // Backstop for the API's in-process 45 s ring timer (e.g. after a restart).
    'calls.sweepRinging': async (_job, logger, c) => {
      const swept = await c.calls.sweepStaleRinging();
      if (swept) logger.info({ swept }, 'stale ringing calls marked missed');
    },
    // Rule 9: grace over → paid numbers are deleted.
    'billing.expireGrace': async (_job, logger, c) => {
      const retired = await c.billing.expireGrace();
      if (retired) logger.info({ retired }, 'paid numbers retired after grace');
    },
    // Rule 9: reminders at renewal failure, day 3 and day 6.
    'billing.reminders': async (_job, logger, c) => {
      for (const reminder of await c.billing.dueReminders()) {
        const intent = c.triggers.forBillingReminder(reminder);
        await c.notifications.sendToAccount(intent.accountId, intent.payload);
        logger.info({ day: reminder.day }, 'billing reminder sent');
      }
    },
    // Phone changes take effect 24 h after verification.
    'account.applyPhoneChanges': async (_job, logger, c) => {
      const applied = await c.compliance.applyDuePhoneChanges();
      if (applied) logger.info({ applied }, 'phone changes applied');
    },
    'auth.cleanup': async (_job, logger, c) => {
      logger.info({ removed: await c.maintenance.cleanupAuth() }, 'auth records cleaned');
    },
  },
  [QUEUES.notify]: {
    'notify.push': async (job, logger, c) => {
      const { accountId, payload } = job.data as { accountId: string; payload: Parameters<typeof c.notifications.sendToAccount>[1] };
      const sent = await c.notifications.sendToAccount(accountId, payload);
      logger.debug({ sent }, 'push delivered');
    },
  },
};

export const repeatableJobs: RepeatableJob[] = [
  { queue: QUEUES.maintenance, name: 'retention.purgeContent', every: 10 * MIN },
  { queue: QUEUES.maintenance, name: 'requests.expire', every: 60 * MIN },
  { queue: QUEUES.maintenance, name: 'calls.sweepRinging', every: MIN },
  { queue: QUEUES.maintenance, name: 'account.applyPhoneChanges', every: 5 * MIN },
  { queue: QUEUES.maintenance, name: 'auth.cleanup', every: 60 * MIN },
  { queue: QUEUES.maintenance, name: 'billing.expireGrace', every: 60 * MIN },
  { queue: QUEUES.maintenance, name: 'billing.reminders', every: 60 * MIN },
  { queue: QUEUES.maintenance, name: 'retention.purgeMetadata', every: 24 * 60 * MIN },
  { queue: QUEUES.maintenance, name: 'reports.purgeEvidence', every: 24 * 60 * MIN },
];
