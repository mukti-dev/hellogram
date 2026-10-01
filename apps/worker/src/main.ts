import { createRedisClient } from '@hellogram/infrastructure';
import { Queue, Worker } from 'bullmq';
import { pino } from 'pino';
import { createWorkerContainer } from './container.js';
import { loadWorkerEnv } from './env.js';
import { QUEUES, handlers, repeatableJobs } from './jobs/registry.js';

async function main(): Promise<void> {
  const env = loadWorkerEnv();
  const logger = pino({
    level: env.LOG_LEVEL,
    ...(env.NODE_ENV === 'development' ? { transport: { target: 'pino-pretty' } } : {}),
  });
  const connection = createRedisClient(env.REDIS_URL, 'hellogram-worker');
  const container = createWorkerContainer(env, connection);
  const prefix = 'hg:bull';

  const workers = Object.entries(handlers).map(
    ([queueName, jobs]) =>
      new Worker(
        queueName,
        async (job) => {
          const handler = jobs[job.name];
          if (!handler) {
            // e.g. a job left over from a scheduler that was since removed: drop it.
            logger.warn({ queue: queueName, job: job.name }, 'no handler — job dropped');
            return;
          }
          await handler(job, logger.child({ queue: queueName, job: job.name, jobId: job.id }), container);
        },
        { connection, prefix, concurrency: 5 },
      ),
  );

  for (const worker of workers) {
    worker.on('failed', (job, error) =>
      logger.error({ queue: worker.name, job: job?.name, err: error }, 'job failed'),
    );
  }

  const queues = new Map<string, Queue>();
  // Drop schedulers that are no longer in the registry (e.g. the Phase 1 heartbeat).
  const maintenanceQueue = new Queue(QUEUES.maintenance, { connection, prefix });
  queues.set('maintenance', maintenanceQueue);
  for (const scheduler of await maintenanceQueue.getJobSchedulers()) {
    if (scheduler.key && !repeatableJobs.some((j) => j.name === scheduler.key)) {
      await maintenanceQueue.removeJobScheduler(scheduler.key);
    }
  }
  for (const { queue, name, every } of repeatableJobs) {
    const q = queues.get(queue) ?? new Queue(queue, { connection, prefix });
    queues.set(queue, q);
    await q.upsertJobScheduler(name, { every }, { name });
  }

  logger.info({ queues: Object.keys(handlers) }, 'worker started');

  const shutdown = async () => {
    logger.info('worker shutting down');
    await Promise.all(workers.map((w) => w.close()));
    await Promise.all([...queues.values()].map((q) => q.close()));
    await connection.quit();
    await container.close();
    process.exit(0);
  };
  process.once('SIGINT', () => void shutdown());
  process.once('SIGTERM', () => void shutdown());
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
