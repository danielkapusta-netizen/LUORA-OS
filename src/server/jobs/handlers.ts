import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { marketplaceAccounts } from '../db/schema';
import { importListings, runReconcile, runStockPush } from '../services/inventory';
import { autoInvoice, runCreateInvoice, runSendKsef, runUploadInvoice } from '../services/invoicing';
import { backfillOrderDetails, syncAccount } from '../services/orders';
import { runCreateShipment, runPollShipment, runPendingSweep } from '../services/shipping';
import { runDeliveryCheck, runMarketplaceProcessing, runPushTracking } from '../services/tracking';
import { enqueue, JOBS, type JobName, type JobPayloads } from './queue';

type Handlers = { [K in JobName]: (data: JobPayloads[K]) => Promise<unknown> };

export const handlers: Handlers = {
  [JOBS.syncAll]: async () => {
    const accounts = await getDb()
      .select({ id: marketplaceAccounts.id })
      .from(marketplaceAccounts)
      .where(and(eq(marketplaceAccounts.enabled, true)));
    for (const account of accounts) await enqueue(JOBS.syncAccount, { accountId: account.id }, { singletonKey: account.id });
    return { queued: accounts.length };
  },
  [JOBS.syncAccount]: ({ accountId }) => syncAccount(accountId),
  [JOBS.shipmentCreate]: ({ shipmentId }) => runCreateShipment(shipmentId),
  [JOBS.shipmentPoll]: ({ shipmentId }) => runPollShipment(shipmentId),
  [JOBS.shipmentSweep]: () => runPendingSweep(),
  [JOBS.trackingPush]: ({ shipmentId }) => runPushTracking(shipmentId),
  [JOBS.marketplaceProcessing]: ({ orderId }) => runMarketplaceProcessing(orderId),
  [JOBS.deliveryCheck]: () => runDeliveryCheck(),
  [JOBS.listingsImport]: ({ accountId }) => importListings(accountId),
  [JOBS.stockPush]: ({ accountId }) => runStockPush(accountId),
  [JOBS.stockReconcile]: () => runReconcile(),
  [JOBS.orderBackfill]: () => backfillOrderDetails(),
  [JOBS.invoiceAuto]: ({ orderId }) => autoInvoice(orderId),
  [JOBS.invoiceCreate]: ({ invoiceId }) => runCreateInvoice(invoiceId),
  [JOBS.invoiceUpload]: ({ invoiceId }) => runUploadInvoice(invoiceId),
  [JOBS.invoiceKsef]: ({ invoiceId }) => runSendKsef(invoiceId),
};

export function runJob<K extends JobName>(name: K, data: JobPayloads[K]): Promise<unknown> {
  return (handlers[name] as (d: JobPayloads[K]) => Promise<unknown>)(data);
}
