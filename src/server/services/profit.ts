// Keeps `sales_lines` (profit per order line, in PLN) in step with orders, fees, refunds,
// shipments, product costs and the profit settings. The calculation itself is the pure
// `orderEconomics`; this file loads what it needs in bulk and writes the result.
import { and, asc, eq, gt, inArray } from 'drizzle-orm';
import { orderEconomics, vatRateFor, type EconomicsShipment } from '../analytics/economics';
import { chunk, getDb, insertStatements, type Tx } from '../db/client';
import { orderFees, orderItems, orderRefunds, orders, productCosts, salesLines, shipments } from '../db/schema';
import { enqueue, JOBS } from '../jobs/queue';
import { loadAnalyticsSettings } from './costs';
import { refreshCustomerStats } from './customers';
import { ensureFxRates, loadFxTable } from './fx';
import { loadAccounting } from './invoicing';

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' });

/** YYYY-MM-DD of a moment in Warsaw time. */
export function warsawDay(at: Date): string {
  return dayFormat.format(at);
}

/** Orders per write; each needs a handful of queries. */
const ORDERS_PER_CHUNK = 60;
/** Orders handled per job of a full recompute. */
const ORDERS_PER_RUN = 300;

export interface RecomputeResult {
  orders: number;
  lines: number;
  /** Orders left without lines because no exchange rate was found for their currency. */
  missingRates: number;
}

/** Recalculates the profit lines of these orders. Cancelled orders end up with none. */
export async function recomputeOrders(orderIds: string[]): Promise<RecomputeResult> {
  const result: RecomputeResult = { orders: 0, lines: 0, missingRates: 0 };
  const ids = [...new Set(orderIds)];
  if (!ids.length) return result;
  const [settings, accounting] = await Promise.all([loadAnalyticsSettings(), loadAccounting()]);
  const vat = accounting.settings;
  const feeVatRate = vat.defaultVatRate ?? 0.23;
  for (const part of chunk(ids, ORDERS_PER_CHUNK)) {
    const r = await recomputeChunk(part, settings, vat, feeVatRate);
    result.orders += r.orders;
    result.lines += r.lines;
    result.missingRates += r.missingRates;
  }
  return result;
}

async function recomputeChunk(
  ids: string[],
  settings: Awaited<ReturnType<typeof loadAnalyticsSettings>>,
  vat: { defaultVatRate?: number; ossRates?: Record<string, number> },
  feeVatRate: number,
): Promise<RecomputeResult> {
  const db = getDb();
  const [orderRows, items, fees, refunds, labels] = await Promise.all([
    db.select().from(orders).where(inArray(orders.id, ids)),
    db.select().from(orderItems).where(inArray(orderItems.orderId, ids)),
    db.select().from(orderFees).where(inArray(orderFees.orderId, ids)),
    db.select().from(orderRefunds).where(inArray(orderRefunds.orderId, ids)),
    db
      .select({ orderId: shipments.orderId, carrier: shipments.carrier, service: shipments.service })
      .from(shipments)
      .where(and(inArray(shipments.orderId, ids), eq(shipments.state, 'created'))),
  ]);
  const live = orderRows.filter((o) => o.status !== 'cancelled');

  // Exchange rates for every currency involved, on the order days.
  const days = live.map((o) => warsawDay(o.placedAt)).sort();
  const currencies = new Set([...live.map((o) => o.currency), ...fees.map((f) => f.currency), ...refunds.map((r) => r.currency)]);
  if (days.length && [...currencies].some((c) => c !== 'PLN')) {
    try {
      await ensureFxRates(currencies, days[0], days.at(-1));
    } catch (err) {
      console.error('[profit] exchange rates:', err instanceof Error ? err.message : err);
    }
  }
  const fx = days.length ? await loadFxTable(currencies, days[0], days.at(-1)!) : null;

  // Every cost entry of the products sold, to pick the one in force on each order day.
  const productIds = [...new Set(items.map((i) => i.productId).filter((p): p is string => Boolean(p)))];
  const costEntries = (
    await Promise.all(
      chunk(productIds).map((pids) => db.select().from(productCosts).where(inArray(productCosts.productId, pids)).orderBy(asc(productCosts.effectiveFrom))),
    )
  ).flat();
  const costsByProduct = new Map<string, { from: string; unitCost: number }[]>();
  for (const c of costEntries) costsByProduct.set(c.productId, [...(costsByProduct.get(c.productId) ?? []), { from: c.effectiveFrom, unitCost: Number(c.unitCost) }]);
  const costOn = (productId: string | null, day: string): number | null => {
    if (!productId) return null;
    let found: number | null = null;
    for (const c of costsByProduct.get(productId) ?? []) if (c.from <= day) found = c.unitCost;
    return found;
  };

  const group = <T extends { orderId: string }>(rows: T[]) => {
    const m = new Map<string, T[]>();
    for (const r of rows) m.set(r.orderId, [...(m.get(r.orderId) ?? []), r]);
    return m;
  };
  const itemsBy = group(items);
  const feesBy = group(fees);
  const refundsBy = group(refunds);
  const labelsBy = group(labels);

  const now = new Date();
  const rows: (typeof salesLines.$inferInsert)[] = [];
  const result: RecomputeResult = { orders: 0, lines: 0, missingRates: 0 };
  for (const o of live) {
    const day = warsawDay(o.placedAt);
    const rate = fx?.rate(o.currency, day) ?? (o.currency === 'PLN' ? 1 : null);
    if (rate === null) {
      result.missingRates++;
      continue;
    }
    const toPln = (amount: number, currency: string) => amount * (currency === o.currency ? rate : (fx?.rate(currency, day) ?? 0));
    const vatRate = vatRateFor(o.shippingAddress.countryCode, vat);
    const orderItemsList = itemsBy.get(o.id) ?? [];
    const lines = orderEconomics({
      marketplace: o.marketplace,
      fxRate: rate,
      vatRate,
      feeVatRate,
      shippingAmount: Number(o.shippingAmount ?? 0),
      settings,
      items: orderItemsList.map((i) => ({
        id: i.id,
        productId: i.productId,
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        discount: Number(i.discountAmount ?? 0),
        unitCost: costOn(i.productId, day),
      })),
      fees: (feesBy.get(o.id) ?? []).map((f) => ({
        itemId: f.orderItemId,
        kind: f.kind,
        amount: toPln(Number(f.amount), f.currency),
        tax: f.taxAmount === null ? null : toPln(Number(f.taxAmount), f.currency),
      })),
      refunds: (refundsBy.get(o.id) ?? []).map((r) => ({
        itemId: r.orderItemId,
        amount: toPln(Number(r.amount), r.currency),
        quantity: r.quantity,
        restocked: r.restocked,
      })),
      shipments: (labelsBy.get(o.id) ?? []) as EconomicsShipment[],
    });
    const productOf = new Map(orderItemsList.map((i) => [i.id, i.productId]));
    for (const l of lines) {
      rows.push({
        ...l,
        orderId: o.id,
        accountId: o.accountId,
        marketplace: o.marketplace,
        productId: productOf.get(l.itemId) ?? null,
        customerId: o.customerId ?? null,
        placedAt: o.placedAt,
        day,
        currency: o.currency,
        fxRate: rate,
        vatRate,
        computedAt: now,
      });
    }
    result.orders++;
  }
  result.lines = rows.length;
  await db.batch([db.delete(salesLines).where(inArray(salesLines.orderId, ids)), ...insertStatements(db, salesLines, rows)] as unknown as Parameters<Tx['batch']>[0]);
  // Customers' lifetime revenue and profit come from these lines.
  const customerIds = [...new Set(orderRows.map((o) => o.customerId).filter((c): c is string => Boolean(c)))];
  if (customerIds.length) await refreshCustomerStats(customerIds);
  return result;
}

/** Called after orders, fees or refunds changed. Never lets a profit problem break the caller. */
export async function refreshProfit(orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  try {
    await recomputeOrders(orderIds);
  } catch (err) {
    console.error('[profit] recompute failed, queued for later:', err instanceof Error ? err.message : err);
    await enqueue(JOBS.profitRecompute, { orderIds: orderIds.slice(0, 500) });
  }
}

/** Rebuilds every order's lines, a few hundred per job (after a cost or settings change, and nightly). */
export async function recomputeAll(after: string | null = null): Promise<RecomputeResult & { done: boolean }> {
  const ids = (
    await getDb()
      .select({ id: orders.id })
      .from(orders)
      .where(after ? gt(orders.id, after) : undefined)
      .orderBy(asc(orders.id))
      .limit(ORDERS_PER_RUN)
  ).map((r) => r.id);
  const result = await recomputeOrders(ids);
  const done = ids.length < ORDERS_PER_RUN;
  if (!done) await enqueue(JOBS.profitRecompute, { after: ids.at(-1)! }, { debounceSeconds: 2, singletonKey: 'continue' });
  return { ...result, done };
}

/** Queues a full rebuild; changes in quick succession collapse into one. */
export async function scheduleFullRecompute(): Promise<void> {
  await enqueue(JOBS.profitRecompute, { all: true }, { debounceSeconds: 30, singletonKey: 'all' });
}
