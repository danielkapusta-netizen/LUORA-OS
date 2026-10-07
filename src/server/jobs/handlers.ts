import { and, eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { marketplaceAccounts } from '../db/schema';
import { syncAccountFees } from '../services/fees';
import { syncFxRates } from '../services/fx';
import { runHistoryImport } from '../services/history';
import { recomputeAll, recomputeOrders } from '../services/profit';
import { resolveMissingCustomers } from '../services/customers';
import { runCrmSync } from '../services/crm-sync';
import { importListings, runReconcile, runStockPush, syncAllStock } from '../services/inventory';
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
  // New products, barcodes and titles typed into Shopify show up in Inventory within minutes, without pressing Import.
  [JOBS.shopifyCatalogue]: async () => {
    const accounts = await getDb()
      .select({ id: marketplaceAccounts.id })
      .from(marketplaceAccounts)
      .where(and(eq(marketplaceAccounts.enabled, true), eq(marketplaceAccounts.type, 'shopify')));
    for (const account of accounts) await importListings(account.id);
    return { accounts: accounts.length };
  },
  [JOBS.stockPush]: ({ accountId, force }) => runStockPush(accountId, { force }),
  [JOBS.stockSyncAll]: () => syncAllStock(),
  [JOBS.stockReconcile]: () => runReconcile(),
  [JOBS.orderBackfill]: () => backfillOrderDetails(),
  [JOBS.invoiceAuto]: ({ orderId }) => autoInvoice(orderId),
  [JOBS.invoiceCreate]: ({ invoiceId }) => runCreateInvoice(invoiceId),
  [JOBS.invoiceUpload]: ({ invoiceId }) => runUploadInvoice(invoiceId),
  [JOBS.invoiceKsef]: ({ invoiceId }) => runSendKsef(invoiceId),
  [JOBS.historyImport]: ({ accountId }) => runHistoryImport(accountId),
  [JOBS.feesSyncAll]: async () => {
    const accounts = await getDb()
      .select({ id: marketplaceAccounts.id })
      .from(marketplaceAccounts)
      .where(and(eq(marketplaceAccounts.enabled, true), eq(marketplaceAccounts.type, 'allegro')));
    for (const account of accounts) await enqueue(JOBS.feesSync, { accountId: account.id }, { singletonKey: account.id });
    return { queued: accounts.length };
  },
  [JOBS.feesSync]: async ({ accountId }) => {
    const result = await syncAccountFees(accountId);
    // A long backlog is read a few weeks per job.
    if (!result.done) await enqueue(JOBS.feesSync, { accountId }, { debounceSeconds: 5, singletonKey: accountId });
    return result;
  },
  [JOBS.fxSync]: () => syncFxRates(),
  [JOBS.customersBackfill]: async () => {
    const result = await resolveMissingCustomers();
    if (result.remaining) await enqueue(JOBS.customersBackfill, {}, { debounceSeconds: 5, singletonKey: 'continue' });
    return result;
  },
  [JOBS.crmSync]: () => runCrmSync(),
  [JOBS.profitRecompute]: (data) => (data?.orderIds ? recomputeOrders(data.orderIds) : recomputeAll(data?.after ?? null)),
};

export function runJob<K extends JobName>(name: K, data: JobPayloads[K]): Promise<unknown> {
  return (handlers[name] as (d: JobPayloads[K]) => Promise<unknown>)(data);
}
