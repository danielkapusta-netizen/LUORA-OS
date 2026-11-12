// A full stock update ("Update all stock" and the schedule): read every marketplace, send the master stock wherever a
// marketplace shows another number, then read again and check that the number arrived. What happened is kept per run,
// so the Inventory page can say, marketplace by marketplace, whether stock got through.
import { and, asc, desc, eq, lt, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { marketplaceAccounts, productListings, products, stockSyncRuns, type StockSyncAccountResult, type StockSyncRun } from '../db/schema';
import { enqueue, JOBS } from '../jobs/queue';
import { loadMarketplaceAccount } from './accounts';
import { desiredQuantity, importListings, runStockPush } from './inventory';

/** A run that has not finished after this long lost a job on the way; it is closed so the next one can start. */
const STALE_AFTER_MS = 20 * 60_000;
/** Marketplaces take a moment to show a new quantity (Empik and HEBE import it in the background). */
const CHECK_DELAY_SECONDS = 45;
const RECHECK_DELAY_SECONDS = 120;
/** Checks per account: after the first one, what still differs is sent once more. */
const MAX_CHECKS = 2;
const PROBLEMS_SHOWN = 8;
const FINISHED = new Set<StockSyncAccountResult['step']>(['done', 'failed', 'skipped']);

const reason = (err: unknown) => (err instanceof Error ? err.message : String(err));

async function closeStaleRuns(): Promise<void> {
  await getDb()
    .update(stockSyncRuns)
    .set({ status: 'failed', finishedAt: new Date() })
    .where(and(eq(stockSyncRuns.status, 'running'), lt(stockSyncRuns.startedAt, new Date(Date.now() - STALE_AFTER_MS))));
}

/** The most recent full update, running or finished. */
export async function latestSyncRun(): Promise<StockSyncRun | null> {
  await closeStaleRuns();
  const [run] = await getDb().select().from(stockSyncRuns).orderBy(desc(stockSyncRuns.startedAt)).limit(1);
  return run ?? null;
}

/** Starts a full update, unless one is already running (then that one is returned). */
export async function startSyncRun(trigger: 'manual' | 'schedule', userId: string | null = null): Promise<{ run: StockSyncRun; started: boolean }> {
  const db = getDb();
  await closeStaleRuns();
  const [running] = await db.select().from(stockSyncRuns).where(eq(stockSyncRuns.status, 'running')).orderBy(desc(stockSyncRuns.startedAt)).limit(1);
  if (running) return { run: running, started: false };

  const accounts = await db
    .select()
    .from(marketplaceAccounts)
    .where(eq(marketplaceAccounts.enabled, true))
    // Shopify first: it defines the products the other marketplaces' offers are linked to.
    .orderBy(sql`${marketplaceAccounts.type} = 'shopify' desc`, asc(marketplaceAccounts.name));
  const results: StockSyncAccountResult[] = accounts.map((a) => ({
    accountId: a.id,
    name: a.name,
    type: a.type,
    step: 'waiting',
    live: a.stockSyncEnabled && !a.stockDryRun,
    read: 0,
    sent: 0,
    refused: 0,
    matching: 0,
    differing: 0,
  }));
  const [run] = await db
    .insert(stockSyncRuns)
    .values({ trigger, userId, accounts: results, status: accounts.length ? 'running' : 'done', finishedAt: accounts.length ? null : new Date() })
    .returning();
  if (accounts.length) await enqueue(JOBS.stockSyncAll, { runId: run.id });
  return { run, started: true };
}

async function loadRun(runId: string): Promise<StockSyncRun | null> {
  const [run] = await getDb().select().from(stockSyncRuns).where(eq(stockSyncRuns.id, runId));
  return run ?? null;
}

/** Where this account's result sits in the run, or null when the run is gone or already closed. */
async function slotOf(runId: string, accountId: string): Promise<number | null> {
  const run = await loadRun(runId);
  if (!run || run.status !== 'running') return null;
  const index = run.accounts.findIndex((a) => a.accountId === accountId);
  return index < 0 ? null : index;
}

/**
 * Changes one account's result. The accounts of a run are worked on by separate jobs at the same time, so each
 * job changes only its own entry, in one statement, instead of writing the whole list back.
 */
async function patch(runId: string, index: number, fields: Partial<StockSyncAccountResult>): Promise<void> {
  const path = `$[${index}]`;
  await getDb().run(sql`
    update stock_sync_runs
    set accounts = json_set(accounts, ${path}, json_patch(json_extract(accounts, ${path}), json(${JSON.stringify(fields)})))
    where id = ${runId}`);
}

async function finish(runId: string, index: number, fields: Partial<StockSyncAccountResult>): Promise<void> {
  await patch(runId, index, fields);
  const run = await loadRun(runId);
  if (!run || run.status !== 'running' || !run.accounts.every((a) => FINISHED.has(a.step))) return;
  await getDb()
    .update(stockSyncRuns)
    .set({ status: 'done', finishedAt: new Date() })
    .where(and(eq(stockSyncRuns.id, runId), eq(stockSyncRuns.status, 'running')));
}

/**
 * Compares what the marketplace was just read to show with what every listing should show. Only meaningful
 * straight after the listings were read.
 */
async function compare(accountId: string): Promise<Pick<StockSyncAccountResult, 'matching' | 'differing' | 'problems'>> {
  const rows = await getDb()
    .select({
      title: productListings.title,
      stock: products.stock,
      seen: productListings.lastSeenQty,
      error: productListings.lastPushError,
      active: productListings.active,
      soldOut: productListings.soldOut,
      stockLocked: productListings.stockLocked,
      stockMode: productListings.stockMode,
      fixedQty: productListings.fixedQty,
    })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    .where(eq(productListings.accountId, accountId))
    .orderBy(asc(productListings.title));
  let matching = 0;
  const problems: NonNullable<StockSyncAccountResult['problems']> = [];
  for (const r of rows) {
    const want = desiredQuantity(r);
    if (want === null) continue;
    // An offer that is off sale sells nothing, whatever number it still carries.
    const has = r.active ? r.seen : 0;
    if (has === want) matching++;
    else problems.push({ title: r.title, want, has, reason: r.error });
  }
  return { matching, differing: problems.length, problems: problems.slice(0, PROBLEMS_SHOWN) };
}

/** The first job of a run: Shopify itself, then one job per other marketplace. */
export async function runSyncAll(runId?: string): Promise<void> {
  // A job queued before runs existed carries no run: start one.
  if (!runId) {
    await startSyncRun('schedule');
    return;
  }
  const run = await loadRun(runId);
  if (!run || run.status !== 'running') return;
  for (const a of run.accounts.filter((x) => x.type === 'shopify')) await runSyncAccount(runId, a.accountId);
  for (const a of run.accounts.filter((x) => x.type !== 'shopify')) await enqueue(JOBS.stockSyncAccount, { runId, accountId: a.accountId });
}

/** One marketplace: read its offers, send what differs, and queue the check. Problems are written to the run, not thrown. */
export async function runSyncAccount(runId: string, accountId: string): Promise<void> {
  const index = await slotOf(runId, accountId);
  if (index === null) return;
  let account: Awaited<ReturnType<typeof loadMarketplaceAccount>>;
  try {
    account = await loadMarketplaceAccount(accountId);
  } catch (err) {
    await finish(runId, index, { step: 'failed', error: reason(err) });
    return;
  }
  await patch(runId, index, { step: 'reading', live: account.stockSyncEnabled && !account.stockDryRun });

  let read: number;
  try {
    read = (await importListings(accountId)).listings;
  } catch (err) {
    console.error(`[stock sync] reading ${account.name}:`, err);
    await finish(runId, index, { step: 'failed', error: `Could not read the offers: ${reason(err)}` });
    return;
  }
  if (!account.stockSyncEnabled) {
    await finish(runId, index, { step: 'skipped', read, ...(await compare(accountId)) });
    return;
  }

  await patch(runId, index, { step: 'sending', read });
  let push: Awaited<ReturnType<typeof runStockPush>>;
  try {
    push = await runStockPush(accountId, { force: true });
  } catch (err) {
    console.error(`[stock sync] sending to ${account.name}:`, err);
    await finish(runId, index, { step: 'failed', error: `Could not send stock: ${reason(err)}`, ...(await compare(accountId)) });
    return;
  }
  // Nothing went out (dry run, or every offer already shows the right number): what was just read is the result.
  if (push.dryRun || push.pushed === 0) {
    await finish(runId, index, { step: 'done', refused: push.refused, ...(await compare(accountId)) });
    return;
  }
  await patch(runId, index, { step: 'checking', sent: push.pushed, refused: push.refused });
  await enqueue(JOBS.stockSyncVerify, { runId, accountId, attempt: 1 }, { startAfterSeconds: CHECK_DELAY_SECONDS });
}

/** Reads the marketplace again after sending. What still differs is sent once more, then reported. */
export async function runSyncVerify(runId: string, accountId: string, attempt: number): Promise<void> {
  const index = await slotOf(runId, accountId);
  if (index === null) return;
  try {
    await importListings(accountId);
  } catch (err) {
    console.error(`[stock sync] checking ${accountId}:`, err);
    await finish(runId, index, { step: 'failed', error: `Stock was sent, but the offers could not be read back: ${reason(err)}` });
    return;
  }
  const result = await compare(accountId);
  if (result.differing > 0 && attempt < MAX_CHECKS) {
    try {
      await runStockPush(accountId, { force: true });
    } catch (err) {
      await finish(runId, index, { step: 'failed', error: `Could not send stock: ${reason(err)}`, ...result });
      return;
    }
    await patch(runId, index, result);
    await enqueue(JOBS.stockSyncVerify, { runId, accountId, attempt: attempt + 1 }, { startAfterSeconds: RECHECK_DELAY_SECONDS });
    return;
  }
  await finish(runId, index, { step: 'done', ...result });
}
