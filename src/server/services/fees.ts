// Marketplace fees and refunds reported outside the order itself (Allegro's billing feed and
// payment refunds). Fees inside the order payload (Empik, Shopify Payments) are stored by the
// order sync; this job reads the separate feeds in time windows, from the oldest order onwards.
import { and, asc, eq, inArray } from 'drizzle-orm';
import { chunk, getDb } from '../db/client';
import { marketplaceAccounts, orderFees, orderItems, orderRefunds, orders } from '../db/schema';
import type { FeeFeed } from '../integrations/marketplaces/types';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';

const DAY = 86_400_000;
/** Each request covers this many days. */
const WINDOW_DAYS = 7;
/** Windows read per job; the job queues itself again while more remain. */
const WINDOWS_PER_RUN = 8;
/** The last days are read again on every run: Allegro books some charges a little late. */
const OVERLAP_DAYS = 2;

export interface FeeSyncResult {
  fees: number;
  refunds: number;
  /** Fees or refunds for orders Luora doesn't have (yet). */
  unmatched: number;
  /** Charges with no order (listing fees, ads, subscriptions). */
  unattached: number;
  /** True when the feed is read up to now. */
  done: boolean;
}

/** Turns the Allegro errors staff see most into something they can act on. */
export function feeSyncError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/HTTP 403/.test(message)) {
    return `Allegro refused access to billing or refunds. In apps.developer.allegro.pl enable the "Billing (read)" and "Payments (read)" permissions for the app, then press "Connect Allegro" again. (${message})`;
  }
  return message;
}

export async function syncAccountFees(accountId: string, now = new Date()): Promise<FeeSyncResult> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const result: FeeSyncResult = { fees: 0, refunds: 0, unmatched: 0, unattached: 0, done: true };
  if (!account.enabled) return result;
  const adapter = getMarketplaceAdapter(account);
  if (!adapter.syncFees) return result;

  let from: Date;
  if (account.feesCursor) from = new Date(account.feesCursor);
  else {
    const [oldest] = await db
      .select({ placedAt: orders.placedAt })
      .from(orders)
      .where(eq(orders.accountId, account.id))
      .orderBy(asc(orders.placedAt))
      .limit(1);
    // Nothing to attach fees to yet.
    if (!oldest) return result;
    from = new Date(oldest.placedAt.getTime() - DAY);
  }

  try {
    for (let i = 0; i < WINDOWS_PER_RUN && from < now; i++) {
      const to = new Date(Math.min(from.getTime() + WINDOW_DAYS * DAY, now.getTime()));
      const feed = await adapter.syncFees(from, to);
      const stored = await storeFeed(account.id, feed);
      result.fees += stored.fees;
      result.refunds += stored.refunds;
      result.unmatched += stored.unmatched;
      result.unattached += feed.unattached;
      from = to;
    }
    result.done = from >= now;
    // Keep the cursor a few days behind "now" so late bookings are read again next time.
    const cursor = new Date(Math.min(from.getTime(), now.getTime() - OVERLAP_DAYS * DAY));
    await db
      .update(marketplaceAccounts)
      .set({ feesCursor: cursor.toISOString(), feesSyncedAt: now, feesError: null })
      .where(eq(marketplaceAccounts.id, account.id));
    return result;
  } catch (err) {
    await db.update(marketplaceAccounts).set({ feesError: feeSyncError(err) }).where(eq(marketplaceAccounts.id, account.id));
    throw err;
  }
}

/** Saves one window of the feed against the orders it belongs to; unknown orders are skipped. */
async function storeFeed(accountId: string, feed: FeeFeed): Promise<{ fees: number; refunds: number; unmatched: number }> {
  const db = getDb();
  const externalIds = [...new Set([...feed.fees, ...feed.refunds].map((x) => x.orderExternalId))];
  const byExternal = new Map<string, string>();
  for (const ids of chunk(externalIds)) {
    const rows = await db
      .select({ id: orders.id, externalId: orders.externalId })
      .from(orders)
      .where(and(eq(orders.accountId, accountId), inArray(orders.externalId, ids)));
    for (const r of rows) byExternal.set(r.externalId, r.id);
  }
  const orderIds = [...byExternal.values()];
  const items = new Map<string, { id: string; quantity: number; unitPrice: string; discountAmount: string | null }>();
  for (const ids of chunk(orderIds)) {
    const rows = await db
      .select({
        id: orderItems.id,
        orderId: orderItems.orderId,
        externalLineId: orderItems.externalLineId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice,
        discountAmount: orderItems.discountAmount,
      })
      .from(orderItems)
      .where(inArray(orderItems.orderId, ids));
    for (const r of rows) items.set(`${r.orderId}:${r.externalLineId}`, r);
  }

  let fees = 0;
  let refunds = 0;
  let unmatched = 0;
  for (const f of feed.fees) {
    const orderId = byExternal.get(f.orderExternalId);
    if (!orderId) {
      unmatched++;
      continue;
    }
    const values = {
      orderId,
      orderItemId: f.externalLineId ? (items.get(`${orderId}:${f.externalLineId}`)?.id ?? null) : null,
      kind: f.kind,
      label: f.label ?? null,
      amount: f.amount,
      taxAmount: f.taxAmount ?? null,
      currency: f.currency,
      occurredAt: f.occurredAt,
    };
    await db
      .insert(orderFees)
      .values({ source: 'allegro_billing', externalId: f.externalId, ...values })
      .onConflictDoUpdate({ target: [orderFees.source, orderFees.externalId], set: values });
    fees++;
  }
  for (const r of feed.refunds) {
    const orderId = byExternal.get(r.orderExternalId);
    if (!orderId) {
      unmatched++;
      continue;
    }
    const item = r.externalLineId ? items.get(`${orderId}:${r.externalLineId}`) : undefined;
    // Only the quantity is known: value it at what the buyer paid per unit of that line.
    let amount = r.amount;
    if (amount === null && item && r.quantity) {
      const perUnit = (Number(item.unitPrice) * item.quantity - Number(item.discountAmount ?? 0)) / Math.max(1, item.quantity);
      amount = (perUnit * r.quantity).toFixed(2);
    }
    if (amount === null) continue;
    const values = {
      orderItemId: item?.id ?? null,
      amount,
      currency: r.currency,
      quantity: r.quantity ?? null,
      restocked: r.restocked ?? false,
      refundedAt: r.refundedAt,
    };
    await db
      .insert(orderRefunds)
      .values({ orderId, externalId: r.externalId, ...values })
      .onConflictDoUpdate({ target: [orderRefunds.orderId, orderRefunds.externalId], set: values });
    refunds++;
  }
  return { fees, refunds, unmatched };
}

/** Reads the feeds again from the oldest order (e.g. after the history import added older orders). */
export async function resetFeeCursor(accountId: string): Promise<void> {
  await getDb().update(marketplaceAccounts).set({ feesCursor: null }).where(eq(marketplaceAccounts.id, accountId));
}
