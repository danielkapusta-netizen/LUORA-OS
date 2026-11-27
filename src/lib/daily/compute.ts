// One shop day (Warsaw) worked out from its sales lines: totals, the hour-by-hour pulse, where the money went, the
// marketplaces, products and orders of the day, and what needs a look. Pure, so the page and the tests share it.
import type { Channel } from '@/lib/analytics/types';

/** One sold order line of the day, in PLN (from `sales_lines`, with the order and product it belongs to). */
export interface DailyLine {
  orderId: string;
  orderNumber: string;
  marketplace: Channel;
  accountName: string | null;
  /** Milliseconds. */
  placedAt: number;
  /** Warsaw day, `YYYY-MM-DD`. */
  day: string;
  /** Warsaw wall clock: hour 0–23 and minute of the day 0–1439. */
  hour: number;
  minuteOfDay: number;
  status: string;
  buyerName: string | null;
  customerId: string | null;
  productKey: string;
  productId: string | null;
  /** The product's key in Analytics → Products: its id, else `item:<sku or name>`. */
  analyticsKey: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  quantity: number;
  refundedQuantity: number;
  gross: number;
  net: number;
  fees: number;
  feesEstimated: boolean;
  cost: number;
  costKnown: boolean;
  shipping: number;
  delivery: number;
  refunds: number;
  profit: number;
}

export interface DayTotals {
  orders: number;
  units: number;
  /** Goods, VAT included. */
  revenue: number;
  profit: number;
  /** Profit as a % of revenue; null without revenue. */
  marginPct: number | null;
  avgBasket: number | null;
}

/** From what buyers paid to what is left: each step is money going out (negative) or, for shipping, sometimes in. */
export interface MoneyBreakdown {
  revenue: number;
  vat: number;
  fees: number;
  cost: number;
  /** Delivery charges less what buyers paid for shipping: positive when shipping cost more than it brought in. */
  shipping: number;
  refunds: number;
  profit: number;
}

export interface HourPoint {
  hour: number;
  revenue: number;
  profit: number;
  orders: number;
}

export interface MarketplaceDay {
  marketplace: Channel;
  revenue: number;
  profit: number;
  orders: number;
  units: number;
}

export interface ProductDay {
  key: string;
  productId: string | null;
  analyticsKey: string;
  name: string;
  brand: string | null;
  imageUrl: string | null;
  units: number;
  orders: number;
  revenue: number;
  profit: number;
  marginPct: number | null;
  /** Profit on one unit sold. */
  profitPerUnit: number | null;
  costMissing: boolean;
}

export interface OrderDay {
  orderId: string;
  number: string;
  marketplace: Channel;
  accountName: string | null;
  placedAt: number;
  buyerName: string | null;
  status: string;
  items: { name: string; quantity: number }[];
  units: number;
  revenue: number;
  profit: number;
  marginPct: number | null;
  feesEstimated: boolean;
  costMissing: boolean;
  refunded: boolean;
}

const sum = <T>(list: T[], pick: (x: T) => number) => list.reduce((s, x) => s + pick(x), 0);
const pct = (part: number, whole: number) => (whole > 0 ? (part / whole) * 100 : null);

/** Lines up to a minute of the day (inclusive), for "yesterday by the same hour". `null` keeps the whole day. */
export function upTo(lines: DailyLine[], minuteOfDay: number | null): DailyLine[] {
  return minuteOfDay === null ? lines : lines.filter((l) => l.minuteOfDay <= minuteOfDay);
}

export function totalsOf(lines: DailyLine[]): DayTotals {
  const orders = new Set(lines.map((l) => l.orderId)).size;
  const revenue = sum(lines, (l) => l.gross);
  const profit = sum(lines, (l) => l.profit);
  return { orders, units: sum(lines, (l) => l.quantity), revenue, profit, marginPct: pct(profit, revenue), avgBasket: orders ? revenue / orders : null };
}

/** The steps from revenue to profit. They add up: revenue − vat − fees − cost − shipping − refunds = profit. */
export function breakdownOf(lines: DailyLine[]): MoneyBreakdown {
  const revenue = sum(lines, (l) => l.gross);
  return {
    revenue,
    vat: revenue - sum(lines, (l) => l.net),
    fees: sum(lines, (l) => l.fees),
    cost: sum(lines, (l) => l.cost),
    shipping: sum(lines, (l) => l.delivery - l.shipping),
    refunds: sum(lines, (l) => l.refunds),
    profit: sum(lines, (l) => l.profit),
  };
}

/** Revenue, profit and orders per Warsaw hour, all 24 hours present. An order counts in the hour it was placed. */
export function hourly(lines: DailyLine[]): HourPoint[] {
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, revenue: 0, profit: 0, orders: new Set<string>() }));
  for (const l of lines) {
    const h = hours[Math.min(Math.max(l.hour, 0), 23)];
    h.revenue += l.gross;
    h.profit += l.profit;
    h.orders.add(l.orderId);
  }
  return hours.map((h) => ({ hour: h.hour, revenue: h.revenue, profit: h.profit, orders: h.orders.size }));
}

export function byMarketplace(lines: DailyLine[]): MarketplaceDay[] {
  const map = new Map<Channel, DailyLine[]>();
  for (const l of lines) map.set(l.marketplace, [...(map.get(l.marketplace) ?? []), l]);
  return [...map.entries()]
    .map(([marketplace, list]) => ({
      marketplace,
      revenue: sum(list, (l) => l.gross),
      profit: sum(list, (l) => l.profit),
      orders: new Set(list.map((l) => l.orderId)).size,
      units: sum(list, (l) => l.quantity),
    }))
    .sort((a, b) => b.revenue - a.revenue);
}

/** Products sold, the biggest revenue first. */
export function byProduct(lines: DailyLine[]): ProductDay[] {
  const map = new Map<string, ProductDay & { orderIds: Set<string> }>();
  for (const l of lines) {
    const p = map.get(l.productKey) ?? {
      key: l.productKey,
      productId: l.productId,
      analyticsKey: l.analyticsKey,
      name: l.name,
      brand: l.brand,
      imageUrl: l.imageUrl,
      units: 0,
      orders: 0,
      revenue: 0,
      profit: 0,
      marginPct: null,
      profitPerUnit: null,
      costMissing: false,
      orderIds: new Set<string>(),
    };
    p.units += l.quantity;
    p.revenue += l.gross;
    p.profit += l.profit;
    p.costMissing ||= !l.costKnown;
    p.imageUrl ??= l.imageUrl;
    p.orderIds.add(l.orderId);
    map.set(l.productKey, p);
  }
  return [...map.values()]
    .map(({ orderIds, ...p }) => ({ ...p, orders: orderIds.size, marginPct: pct(p.profit, p.revenue), profitPerUnit: p.units ? p.profit / p.units : null }))
    .sort((a, b) => b.revenue - a.revenue || b.units - a.units || a.name.localeCompare(b.name));
}

/** The day's orders, the newest first. */
export function byOrder(lines: DailyLine[]): OrderDay[] {
  const map = new Map<string, OrderDay>();
  for (const l of lines) {
    const o = map.get(l.orderId) ?? {
      orderId: l.orderId,
      number: l.orderNumber,
      marketplace: l.marketplace,
      accountName: l.accountName,
      placedAt: l.placedAt,
      buyerName: l.buyerName,
      status: l.status,
      items: [],
      units: 0,
      revenue: 0,
      profit: 0,
      marginPct: null,
      feesEstimated: false,
      costMissing: false,
      refunded: false,
    };
    o.items.push({ name: l.name, quantity: l.quantity });
    o.units += l.quantity;
    o.revenue += l.gross;
    o.profit += l.profit;
    o.feesEstimated ||= l.feesEstimated;
    o.costMissing ||= !l.costKnown;
    o.refunded ||= l.refunds > 0 || l.refundedQuantity > 0;
    map.set(l.orderId, o);
  }
  return [...map.values()].map((o) => ({ ...o, marginPct: pct(o.profit, o.revenue) })).sort((a, b) => b.placedAt - a.placedAt);
}

/** The change from `before` to `now` in %, or null when there is nothing to compare with. */
export function changePct(now: number | null, before: number | null): number | null {
  if (now === null || before === null || before === 0) return null;
  return ((now - before) / Math.abs(before)) * 100;
}

/** How the day's margin reads at a glance. */
export function marginWord(marginPct: number | null): 'healthy' | 'thin' | 'loss' | null {
  if (marginPct === null) return null;
  if (marginPct < 0) return 'loss';
  return marginPct < 15 ? 'thin' : 'healthy';
}

export type AttentionKind = 'loss' | 'costMissing' | 'feesEstimated' | 'cancelled' | 'refunded' | 'pending';

export interface AttentionItem {
  kind: AttentionKind;
  count: number;
  /** PLN involved (loss, cancelled or refunded value), when it means something. */
  amount: number | null;
}

/**
 * What needs a look today, the most urgent first. Orders sold at a loss and products without a cost distort the
 * profit; estimated fees settle with the next fee sync; cancellations, refunds and orders still waiting for their
 * profit (no exchange rate yet) are listed so nothing happens unseen.
 */
export function attentionOf(
  orders: OrderDay[],
  products: ProductDay[],
  extra: { cancelled: { count: number; amount: number }; refunded: { count: number; amount: number }; pending: number },
): AttentionItem[] {
  const losing = orders.filter((o) => o.profit < 0);
  const items: AttentionItem[] = [
    { kind: 'loss', count: losing.length, amount: losing.length ? sum(losing, (o) => o.profit) : null },
    { kind: 'costMissing', count: products.filter((p) => p.costMissing).length, amount: null },
    { kind: 'pending', count: extra.pending, amount: null },
    { kind: 'cancelled', count: extra.cancelled.count, amount: extra.cancelled.count ? extra.cancelled.amount : null },
    { kind: 'refunded', count: extra.refunded.count, amount: extra.refunded.count ? extra.refunded.amount : null },
    { kind: 'feesEstimated', count: orders.filter((o) => o.feesEstimated).length, amount: null },
  ];
  return items.filter((i) => i.count > 0);
}
