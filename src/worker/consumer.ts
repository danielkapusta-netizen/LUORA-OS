// Queue consumer and cron dispatcher, kept free of OpenNext imports so tests can run them.
import { setCfEnv, type CfEnv } from '../server/cf';
import { runJob } from '../server/jobs/handlers';
import { JOBS, releaseLock, RETRY_POLICY, type JobMessage, type JobName } from '../server/jobs/queue';

export async function handleBatch(batch: MessageBatch<JobMessage>, env: CfEnv): Promise<void> {
  setCfEnv(env);
  for (const msg of batch.messages) {
    const { name, data, lockKey } = msg.body;
    const policy = RETRY_POLICY[name] ?? { retries: 0, delaySeconds: 0 };
    try {
      await runJob(name, data as never);
      msg.ack();
      if (lockKey) await releaseLock(lockKey);
    } catch (err) {
      console.error(`[job] ${name} failed (attempt ${msg.attempts}):`, err instanceof Error ? err.message : err);
      if (msg.attempts <= policy.retries) {
        msg.retry({ delaySeconds: policy.delaySeconds * 2 ** (msg.attempts - 1) });
      } else {
        msg.ack();
        if (lockKey) await releaseLock(lockKey);
      }
    }
  }
}

/**
 * Cron expression (as written in wrangler.jsonc) → jobs to run. Several jobs share a schedule
 * because the number of cron triggers per Worker is limited.
 */
export const CRON_JOBS: Record<string, JobName[]> = {
  '*/3 * * * *': [JOBS.syncAll],
  '*/2 * * * *': [JOBS.shipmentSweep],
  '15 */2 * * *': [JOBS.deliveryCheck, JOBS.feesSyncAll],
  '30 2 * * *': [JOBS.stockReconcile, JOBS.fxSync],
  '*/15 * * * *': [JOBS.orderBackfill],
};

export async function handleScheduled(controller: ScheduledController, env: CfEnv): Promise<void> {
  setCfEnv(env);
  const jobs = CRON_JOBS[controller.cron];
  if (!jobs) {
    console.warn(`[cron] no job for "${controller.cron}"`);
    return;
  }
  // One failing job must not keep the others on the same schedule from running.
  const results = await Promise.allSettled(jobs.map((job) => runJob(job, {} as never)));
  results.forEach((r, i) => {
    if (r.status === 'rejected') console.error(`[cron] ${jobs[i]} failed:`, r.reason instanceof Error ? r.reason.message : r.reason);
  });
}
