// Sales performance per product for the Inventory page: units sold, revenue in PLN, a
// performance level compared with the other products, and the product's sales rank.
import { and, eq, gte, isNotNull, ne, sql } from 'drizzle-orm';
import { getDb } from '../db/client';
import { orderItems, orders } from '../db/schema';
import { plnRateOn } from './fx';

export type PerformanceLevel = 'excellent' | 'good' | 'low' | 'none';

export interface ProductPerformance {
  units: number;
  orders: number;
  /** Revenue in PLN; foreign currencies converted at the NBP rate. */
  revenue: number;
  /** Units per marketplace. */
  byMarketplace: Record<string, number>;
  /** Share of selling products that sold the same or less (0–1); 0 when nothing sold. */
  percentile: number;
  level: PerformanceLevel;
  /** 1 = best seller; null when nothing sold. */
  rank: number | null;
  rankByMarketplace: Record<string, number>;
}

const EMPTY: ProductPerformance = { units: 0, orders: 0, revenue: 0, byMarketplace: {}, percentile: 0, level: 'none', rank: null, rankByMarketplace: {} };

export function emptyPerformance(): ProductPerformance {
  return { ...EMPTY, byMarketplace: {}, rankByMarketplace: {} };
}

export function levelFor(percentile: number, units: number): PerformanceLevel {
  if (units <= 0) return 'none';
  if (percentile >= 0.75) return 'excellent';
  if (percentile >= 0.25) return 'good';
  return 'low';
}

/** Competition ranking (1, 2, 2, 4) by units, highest first; products with no units get no rank. */
function ranks(units: Map<string, number>): Map<string, number> {
  const sorted = [...units].filter(([, u]) => u > 0).sort((a, b) => b[1] - a[1]);
  const out = new Map<string, number>();
  sorted.forEach(([id, u], i) => out.set(id, i > 0 && sorted[i - 1][1] === u ? out.get(sorted[i - 1][0])! : i + 1));
  return out;
}

/** Turns raw per-product totals into levels, percentiles and ranks. Pure, so it is unit-tested. */
export function rate(totals: Map<string, Omit<ProductPerformance, 'percentile' | 'level' | 'rank' | 'rankByMarketplace'>>): Map<string, ProductPerformance> {
  const selling = [...totals.values()].map((t) => t.units).filter((u) => u > 0);
  const overall = ranks(new Map([...totals].map(([id, t]) => [id, t.units])));
  const marketplaces = new Set([...totals.values()].flatMap((t) => Object.keys(t.byMarketplace)));
  const perMarketplace = new Map(
    [...marketplaces].map((m) => [m, ranks(new Map([...totals].map(([id, t]) => [id, t.byMarketplace[m] ?? 0])))]),
  );
  const out = new Map<string, ProductPerformance>();
  for (const [id, t] of totals) {
    const percentile = t.units > 0 ? selling.filter((u) => u <= t.units).length / selling.length : 0;
    const rankByMarketplace: Record<string, number> = {};
    for (const [m, r] of perMarketplace) if (r.has(id)) rankByMarketplace[m] = r.get(id)!;
    out.set(id, { ...t, percentile, level: levelFor(percentile, t.units), rank: overall.get(id) ?? null, rankByMarketplace });
  }
  return out;
}

/** Sales of every product over the last `days` days (cancelled orders left out). */
export async function productStats(days = 30, now = new Date()) {
  const since = new Date(now.getTime() - days * 86_400_000);
  const rows = await getDb()
    .select({
      productId: orderItems.productId,
      marketplace: orders.marketplace,
      currency: orders.currency,
      units: sql<number>`sum(${orderItems.quantity})`,
      revenue: sql<number>`sum(${orderItems.quantity} * cast(${orderItems.unitPrice} as real))`,
      orders: sql<number>`count(distinct ${orders.id})`,
    })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(and(isNotNull(orderItems.productId), gte(orders.placedAt, since), ne(orders.status, 'cancelled')))
    .groupBy(orderItems.productId, orders.marketplace, orders.currency);

  const rates = new Map<string, number | null>();
  for (const currency of new Set(rows.map((r) => r.currency))) rates.set(currency, await plnRateOn(currency));

  const totals = new Map<string, Omit<ProductPerformance, 'percentile' | 'level' | 'rank' | 'rankByMarketplace'>>();
  for (const r of rows) {
    const t = totals.get(r.productId!) ?? { units: 0, orders: 0, revenue: 0, byMarketplace: {} };
    t.units += r.units;
    t.orders += r.orders;
    t.revenue += r.revenue * (rates.get(r.currency) ?? 0);
    t.byMarketplace[r.marketplace] = (t.byMarketplace[r.marketplace] ?? 0) + r.units;
    totals.set(r.productId!, t);
  }
  return {
    byProduct: rate(totals),
    missingRates: [...rates].filter(([, v]) => v === null).map(([c]) => c),
  };
}
