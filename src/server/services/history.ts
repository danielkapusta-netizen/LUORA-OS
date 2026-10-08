// One-off import of every past order of a marketplace account, so analytics has a full history.
// It runs as a chain of short jobs (each a few pages) and can be resumed after an error. Past
// orders are stored as historical: closed, never labelled, invoiced or taken from stock.
import { eq } from 'drizzle-orm';
import { getDb } from '../db/client';
import { marketplaceAccounts, type MarketplaceAccount } from '../db/schema';
import type { NormalizedOrder } from '../integrations/types';
import { enqueue, JOBS } from '../jobs/queue';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { resetFeeCursor } from './fees';
import { upsertOrders } from './orders';

/** Adapter calls per job; each reads a few pages of orders. */
const STEPS_PER_RUN = 3;

/**
 * Open orders from the last days belong to the regular sync (it puts them on To do and takes
 * their stock); the history import leaves them alone.
 */
export function belongsToHistory(n: NormalizedOrder, account: Pick<MarketplaceAccount, 'settings'>, now = new Date()): boolean {
  if (n.cancelled || n.fulfilled) return true;
  const recentDays = account.settings.initialSyncDays ?? 14;
  return n.placedAt.getTime() < now.getTime() - recentDays * 86_400_000;
}

/** Starts the import, or resumes it after an error. `restart` begins again from the newest order. */
export async function startHistoryImport(accountId: string, options: { restart?: boolean } = {}): Promise<void> {
  const account = await loadMarketplaceAccount(accountId);
  if (!getMarketplaceAdapter(account).syncHistory) throw new Error(`${account.name} can't import past orders`);
  const restart = options.restart || account.historyState === 'done' || account.historyState === 'idle';
  await getDb()
    .update(marketplaceAccounts)
    .set({
      historyState: 'running',
      historyError: null,
      historyUpdatedAt: new Date(),
      ...(restart ? { historyCursor: null, historyImported: 0 } : {}),
    })
    .where(eq(marketplaceAccounts.id, accountId));
  await enqueue(JOBS.historyImport, { accountId }, { singletonKey: accountId });
}

export async function stopHistoryImport(accountId: string): Promise<void> {
  await getDb()
    .update(marketplaceAccounts)
    .set({ historyState: 'error', historyError: 'Stopped by hand', historyUpdatedAt: new Date() })
    .where(eq(marketplaceAccounts.id, accountId));
}

export async function runHistoryImport(accountId: string): Promise<{ imported: number; done: boolean }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  // Stopped, or another chain already finished it.
  if (account.historyState !== 'running') return { imported: 0, done: true };
  const adapter = getMarketplaceAdapter(account);
  if (!adapter.syncHistory) return { imported: 0, done: true };

  let cursor = account.historyCursor;
  let imported = 0;
  let done = false;
  try {
    for (let step = 0; step < STEPS_PER_RUN && !done; step++) {
      const result = await adapter.syncHistory(cursor);
      const past = result.orders.filter((o) => belongsToHistory(o, account));
      const stored = await upsertOrders(account, past, { historical: true });
      imported += stored.created;
      cursor = result.nextCursor;
      done = !result.hasMore;
      // Progress is saved after every step, so an error resumes from here.
      await db
        .update(marketplaceAccounts)
        .set({ historyCursor: cursor, historyImported: account.historyImported + imported, historyUpdatedAt: new Date() })
        .where(eq(marketplaceAccounts.id, accountId));
    }
  } catch (err) {
    await db
      .update(marketplaceAccounts)
      .set({ historyState: 'error', historyError: err instanceof Error ? err.message : String(err), historyUpdatedAt: new Date() })
      .where(eq(marketplaceAccounts.id, accountId));
    throw err;
  }

  if (done) {
    await db.update(marketplaceAccounts).set({ historyState: 'done', historyUpdatedAt: new Date() }).where(eq(marketplaceAccounts.id, accountId));
    // Older orders now exist: read the fee feed again from the start, and fetch their exchange rates.
    await resetFeeCursor(accountId);
    await enqueue(JOBS.feesSync, { accountId }, { singletonKey: accountId });
    await enqueue(JOBS.fxSync, {}, { debounceSeconds: 30 });
  } else {
    // A debounce key (not the singleton this job holds) so the next step can be queued now.
    await enqueue(JOBS.historyImport, { accountId }, { debounceSeconds: 5, singletonKey: accountId });
  }
  return { imported, done };
}
