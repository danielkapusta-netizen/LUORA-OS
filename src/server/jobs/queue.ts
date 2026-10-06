import { lt, sql } from 'drizzle-orm';
import { getCfEnv } from '../cf';
import { getDb } from '../db/client';
import { jobLocks } from '../db/schema';

export const JOBS = {
  syncAll: 'orders-sync-all',
  syncAccount: 'orders-sync',
  shipmentCreate: 'shipment-create',
  shipmentPoll: 'shipment-poll',
  shipmentSweep: 'shipment-sweep',
  trackingPush: 'tracking-push',
  marketplaceProcessing: 'marketplace-processing',
  deliveryCheck: 'delivery-check',
  listingsImport: 'listings-import',
  stockPush: 'stock-push',
  stockReconcile: 'stock-reconcile',
  stockSyncAll: 'stock-sync-all',
  orderBackfill: 'order-backfill',
  invoiceAuto: 'invoice-auto',
  invoiceCreate: 'invoice-create',
  invoiceUpload: 'invoice-upload',
  invoiceKsef: 'invoice-ksef',
  historyImport: 'history-import',
  feesSyncAll: 'fees-sync-all',
  feesSync: 'fees-sync',
  fxSync: 'fx-sync',
  profitRecompute: 'profit-recompute',
  customersBackfill: 'customers-backfill',
  crmSync: 'crm-shopify-sync',
} as const;

export interface JobPayloads {
  [JOBS.syncAll]: Record<string, never>;
  [JOBS.syncAccount]: { accountId: string };
  [JOBS.shipmentCreate]: { shipmentId: string };
  [JOBS.shipmentPoll]: { shipmentId: string };
  [JOBS.shipmentSweep]: Record<string, never>;
  [JOBS.trackingPush]: { shipmentId: string };
  [JOBS.marketplaceProcessing]: { orderId: string };
  [JOBS.deliveryCheck]: Record<string, never>;
  [JOBS.listingsImport]: { accountId: string };
  /** force: compare with the quantity last read from the marketplace, not with our last push. */
  [JOBS.stockPush]: { accountId: string; force?: boolean };
  [JOBS.stockReconcile]: Record<string, never>;
  [JOBS.stockSyncAll]: Record<string, never>;
  [JOBS.orderBackfill]: Record<string, never>;
  [JOBS.invoiceAuto]: { orderId: string };
  [JOBS.invoiceCreate]: { invoiceId: string };
  [JOBS.invoiceUpload]: { invoiceId: string };
  [JOBS.invoiceKsef]: { invoiceId: string };
  [JOBS.historyImport]: { accountId: string };
  [JOBS.feesSyncAll]: Record<string, never>;
  [JOBS.feesSync]: { accountId: string };
  [JOBS.fxSync]: Record<string, never>;
  /** orderIds: just these; otherwise every order, continuing after `after`. */
  [JOBS.profitRecompute]: { orderIds?: string[]; all?: boolean; after?: string };
  [JOBS.customersBackfill]: Record<string, never>;
  [JOBS.crmSync]: Record<string, never>;
}

export type JobName = keyof JobPayloads;

/** Body of a message on the `luora-jobs` Cloudflare Queue. */
export interface JobMessage {
  name: JobName;
  data: unknown;
  /** Set for singleton jobs; the consumer releases it when the job ends. */
  lockKey?: string;
}

export interface EnqueueOptions {
  /** Delay before the job may run. */
  startAfterSeconds?: number;
  /** Only one queued or running job per key (e.g. one sync per account). */
  singletonKey?: string;
  /** Collapse bursts: at most one job per key per this many seconds. */
  debounceSeconds?: number;
}

type EnqueueFn = <K extends JobName>(name: K, data: JobPayloads[K], options?: EnqueueOptions) => Promise<void>;

/** Retries per job. Label purchases never retry automatically: a retry could buy a second label. */
export const RETRY_POLICY: Record<JobName, { retries: number; delaySeconds: number }> = {
  [JOBS.syncAll]: { retries: 0, delaySeconds: 0 },
  [JOBS.syncAccount]: { retries: 2, delaySeconds: 30 },
  [JOBS.shipmentCreate]: { retries: 0, delaySeconds: 0 },
  [JOBS.shipmentPoll]: { retries: 3, delaySeconds: 10 },
  [JOBS.shipmentSweep]: { retries: 0, delaySeconds: 0 },
  [JOBS.trackingPush]: { retries: 5, delaySeconds: 60 },
  [JOBS.marketplaceProcessing]: { retries: 3, delaySeconds: 60 },
  [JOBS.deliveryCheck]: { retries: 0, delaySeconds: 0 },
  [JOBS.listingsImport]: { retries: 1, delaySeconds: 60 },
  [JOBS.stockPush]: { retries: 3, delaySeconds: 60 },
  [JOBS.stockReconcile]: { retries: 0, delaySeconds: 0 },
  [JOBS.stockSyncAll]: { retries: 0, delaySeconds: 0 },
  [JOBS.orderBackfill]: { retries: 0, delaySeconds: 0 },
  [JOBS.invoiceAuto]: { retries: 2, delaySeconds: 60 },
  // Issuing is not retried automatically: the invoice id is saved first, but a lost response could still issue twice.
  [JOBS.invoiceCreate]: { retries: 0, delaySeconds: 0 },
  [JOBS.invoiceUpload]: { retries: 5, delaySeconds: 60 },
  [JOBS.invoiceKsef]: { retries: 3, delaySeconds: 120 },
  // The import saves its progress; a failed step is resumed by hand ("Resume").
  [JOBS.historyImport]: { retries: 0, delaySeconds: 0 },
  [JOBS.feesSyncAll]: { retries: 0, delaySeconds: 0 },
  [JOBS.feesSync]: { retries: 1, delaySeconds: 300 },
  [JOBS.fxSync]: { retries: 2, delaySeconds: 600 },
  [JOBS.profitRecompute]: { retries: 2, delaySeconds: 120 },
  [JOBS.customersBackfill]: { retries: 1, delaySeconds: 120 },
  [JOBS.crmSync]: { retries: 1, delaySeconds: 600 },
};

/** A singleton lock is dropped after this long even if its job never reports back. */
const SINGLETON_TTL_SECONDS = 15 * 60;

const holder = globalThis as unknown as { __luoraEnqueue?: EnqueueFn };

/** Takes the lock unless a live one exists. Returns false when the job should be skipped. */
async function acquireLock(key: string, seconds: number): Promise<boolean> {
  const now = Date.now();
  const rows = await getDb()
    .insert(jobLocks)
    .values({ key, until: new Date(now + seconds * 1000) })
    .onConflictDoUpdate({ target: jobLocks.key, set: { until: new Date(now + seconds * 1000) }, setWhere: lt(jobLocks.until, new Date(now)) })
    .returning({ key: jobLocks.key });
  return rows.length > 0;
}

export async function releaseLock(key: string): Promise<void> {
  await getDb().delete(jobLocks).where(sql`${jobLocks.key} = ${key}`);
}

export const enqueue: EnqueueFn = async (name, data, options = {}) => {
  if (holder.__luoraEnqueue) return holder.__luoraEnqueue(name, data, options);
  const message: JobMessage = { name, data };
  let delaySeconds = options.startAfterSeconds;

  if (options.debounceSeconds) {
    // The job runs once the window closes and reads the latest state, so later calls in the window can be dropped.
    if (!(await acquireLock(`debounce:${name}:${options.singletonKey ?? ''}`, options.debounceSeconds))) return;
    delaySeconds = options.debounceSeconds;
  } else if (options.singletonKey) {
    const key = `single:${name}:${options.singletonKey}`;
    if (!(await acquireLock(key, SINGLETON_TTL_SECONDS))) return;
    message.lockKey = key;
  }
  await getCfEnv().JOBS.send(message, delaySeconds ? { delaySeconds: Math.min(Math.ceil(delaySeconds), 43_200) } : undefined);
};

/** Tests replace the queue with an in-memory recorder. */
export function setEnqueueImplementation(fn: EnqueueFn | undefined): void {
  holder.__luoraEnqueue = fn;
}
