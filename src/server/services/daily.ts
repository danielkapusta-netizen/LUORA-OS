// The Daily overview: one Warsaw day of sales, read straight from `sales_lines` for that day, the day before and the
// same weekday a week earlier (not the whole history), with the day's cancellations, refunds and orders still waiting
// for their profit. Figures for "today" are compared with the other two days up to the same time of day.
import { and, eq, gte, inArray, lt, lte, ne, sql } from 'drizzle-orm';
import type { Channel } from '@/lib/analytics/types';
import { dayEnd, dayStart, isCalendarDay, plusDays, shopClock, today as shopToday } from '@/lib/analytics/window';
import {
  attentionOf,
  breakdownOf,
  byMarketplace,
  byOrder,
  byProduct,
  hourly,
  totalsOf,
  upTo,
  type AttentionItem,
  type DailyLine,
  type DayTotals,
  type HourPoint,
  type MarketplaceDay,
  type MoneyBreakdown,
  type OrderDay,
  type ProductDay,
} from '@/lib/daily/compute';
import { cleanShopifyTitle } from '@/lib/sku';
import { chunk, getDb } from '../db/client';
import { marketplaceAccounts, orderItems, orderRefunds, orders, products, salesLines } from '../db/schema';
import { loadFxTable } from './fx';

export const DAILY_CHANNELS: readonly Channel[] = ['allegro', 'shopify', 'empik', 'erli', 'hebe', 'vonhalsky'];

export interface DailyOverview {
  day: string;
  isToday: boolean;
  /** Comparisons stop at this Warsaw minute of the day (today), or cover whole days (null, a past day). */
  cutoffMinute: number | null;
  marketplace: Channel | null;
  /** Marketplaces with an account, for the filter. */
  marketplaces: Channel[];
  /** False for roles that may see margins but not profit: every profit amount is 0 and `breakdown` is in % of revenue. */
  showProfit: boolean;
  totals: DayTotals;
  yesterday: DayTotals;
  lastWeek: DayTotals;
  /** Orders over the whole of the same weekday a week earlier, for "84% of last Thursday". */
  lastWeekFullDayOrders: number;
  hours: HourPoint[];
  /** The same weekday a week earlier, whole day: the faint line under today's hours. */
  hoursLastWeek: HourPoint[];
  breakdown: MoneyBreakdown;
  breakdownUnit: 'pln' | 'pct';
  /** Every marketplace that sold that day, whatever the filter, so the split doubles as the filter. */
  marketplaceSplit: MarketplaceDay[];
  products: ProductDay[];
  orders: OrderDay[];
  customers: { new: number; returning: number };
  cancelled: { count: number; amount: number };
  refunded: { count: number; amount: number };
  attention: AttentionItem[];
  /** Newest order of the day (ms), for "last order 8 min ago". */
  lastOrderAt: number | null;
}

export function parseDailyDay(value: string | undefined, now = new Date()): string {
  const todayKey = shopToday(now);
  return isCalendarDay(value) && value <= todayKey ? value : todayKey;
}

export function parseDailyMarketplace(value: string | undefined): Channel | null {
  return DAILY_CHANNELS.find((c) => c === value) ?? null;
}

async function linesFor(days: string[]): Promise<DailyLine[]> {
  const rows = await getDb()
    .select({
      orderId: salesLines.orderId,
      orderNumber: orders.externalNumber,
      marketplace: salesLines.marketplace,
      accountName: marketplaceAccounts.name,
      placedAt: salesLines.placedAt,
      day: salesLines.day,
      status: orders.status,
      buyer: orders.buyer,
      customerId: salesLines.customerId,
      productId: salesLines.productId,
      sku: orderItems.sku,
      itemName: orderItems.name,
      itemImage: orderItems.imageUrl,
      productName: products.name,
      productImage: products.imageUrl,
      brand: products.brand,
      quantity: salesLines.quantity,
      refundedQuantity: salesLines.refundedQuantity,
      gross: salesLines.gross,
      net: salesLines.net,
      fees: salesLines.fees,
      feesEstimated: salesLines.feesEstimated,
      cost: salesLines.cost,
      costKnown: salesLines.costKnown,
      shipping: salesLines.shipping,
      delivery: salesLines.delivery,
      refunds: salesLines.refunds,
      profit: salesLines.profit,
    })
    .from(salesLines)
    .innerJoin(orders, eq(orders.id, salesLines.orderId))
    .innerJoin(orderItems, eq(orderItems.id, salesLines.itemId))
    .leftJoin(products, eq(products.id, salesLines.productId))
    .leftJoin(marketplaceAccounts, eq(marketplaceAccounts.id, salesLines.accountId))
    .where(inArray(salesLines.day, days));
  return rows.map((r) => {
    const at = r.placedAt.getTime();
    const clock = shopClock(at);
    return {
      orderId: r.orderId,
      orderNumber: r.orderNumber ?? r.orderId.slice(0, 8),
      marketplace: r.marketplace as Channel,
      accountName: r.accountName,
      placedAt: at,
      day: r.day,
      hour: clock.hour,
      minuteOfDay: clock.minuteOfDay,
      status: r.status,
      buyerName: r.buyer?.name ?? null,
      customerId: r.customerId,
      productKey: r.productId ? `p:${r.productId}` : r.sku ? `s:${r.sku.toLowerCase()}` : `n:${r.itemName.toLowerCase()}`,
      productId: r.productId,
      name: r.productName ? cleanShopifyTitle(r.productName) : r.itemName,
      brand: r.brand,
      imageUrl: r.productImage ?? r.itemImage,
      quantity: r.quantity,
      refundedQuantity: r.refundedQuantity,
      gross: r.gross,
      net: r.net,
      fees: r.fees,
      feesEstimated: r.feesEstimated,
      cost: r.cost,
      costKnown: r.costKnown,
      shipping: r.shipping,
      delivery: r.delivery,
      refunds: r.refunds,
      profit: r.profit,
    };
  });
}

/** Customers of the day who had bought before it. */
async function returningCustomers(ids: string[], day: string): Promise<Set<string>> {
  const seen = new Set<string>();
  for (const part of chunk(ids)) {
    const rows = await getDb()
      .selectDistinct({ id: salesLines.customerId })
      .from(salesLines)
      .where(and(inArray(salesLines.customerId, part), lt(salesLines.day, day)));
    for (const r of rows) if (r.id) seen.add(r.id);
  }
  return seen;
}

/** Orders placed that day and cancelled (they have no sales lines), with their value in PLN. */
async function cancelledOn(day: string, marketplace: Channel | null): Promise<{ count: number; amount: number }> {
  const rows = await getDb()
    .select({ total: orders.totalAmount, currency: orders.currency })
    .from(orders)
    .where(
      and(
        eq(orders.status, 'cancelled'),
        eq(orders.historical, false),
        gte(orders.placedAt, dayStart(day)),
        lte(orders.placedAt, dayEnd(day)),
        marketplace ? eq(orders.marketplace, marketplace) : undefined,
      ),
    );
  const fx = await loadFxTable(
    rows.map((r) => r.currency),
    day,
    day,
  );
  return { count: rows.length, amount: rows.reduce((s, r) => s + Number(r.total ?? 0) * (fx.rate(r.currency, day) ?? 0), 0) };
}

/** Refunds paid out that day (whenever the order was placed), in PLN, and how many orders they were for. */
async function refundedOn(day: string, marketplace: Channel | null): Promise<{ count: number; amount: number }> {
  const rows = await getDb()
    .select({ orderId: orderRefunds.orderId, amount: orderRefunds.amount, currency: orderRefunds.currency })
    .from(orderRefunds)
    .innerJoin(orders, eq(orders.id, orderRefunds.orderId))
    .where(and(gte(orderRefunds.refundedAt, dayStart(day)), lte(orderRefunds.refundedAt, dayEnd(day)), marketplace ? eq(orders.marketplace, marketplace) : undefined));
  const fx = await loadFxTable(
    rows.map((r) => r.currency),
    day,
    day,
  );
  return { count: new Set(rows.map((r) => r.orderId)).size, amount: rows.reduce((s, r) => s + Number(r.amount) * (fx.rate(r.currency, day) ?? 0), 0) };
}

/** Orders placed that day, not cancelled, whose profit isn't worked out yet (no exchange rate, or just arrived). */
async function pendingOn(day: string, marketplace: Channel | null): Promise<number> {
  const [row] = await getDb()
    .select({ n: sql<number>`count(*)` })
    .from(orders)
    .where(
      and(
        ne(orders.status, 'cancelled'),
        eq(orders.historical, false),
        gte(orders.placedAt, dayStart(day)),
        lte(orders.placedAt, dayEnd(day)),
        marketplace ? eq(orders.marketplace, marketplace) : undefined,
        sql`not exists (select 1 from ${salesLines} where ${salesLines.orderId} = ${orders.id})`,
      ),
    );
  return Number(row?.n ?? 0);
}

async function marketplacesWithAccounts(): Promise<Channel[]> {
  const rows = await getDb().selectDistinct({ type: marketplaceAccounts.type }).from(marketplaceAccounts);
  const have = new Set(rows.map((r) => r.type));
  return DAILY_CHANNELS.filter((c) => have.has(c));
}

/** Profit amounts removed, margins kept; the money breakdown becomes shares of revenue. */
function withoutProfit(o: DailyOverview): DailyOverview {
  const noProfit = <T extends { profit: number }>(x: T): T => ({ ...x, profit: 0 });
  const b = o.breakdown;
  const share = (v: number) => (b.revenue > 0 ? (v / b.revenue) * 100 : 0);
  return {
    ...o,
    showProfit: false,
    totals: noProfit(o.totals),
    yesterday: noProfit(o.yesterday),
    lastWeek: noProfit(o.lastWeek),
    hours: o.hours.map(noProfit),
    hoursLastWeek: o.hoursLastWeek.map(noProfit),
    breakdown: { revenue: 100, vat: share(b.vat), fees: share(b.fees), cost: share(b.cost), shipping: share(b.shipping), refunds: share(b.refunds), profit: share(b.profit) },
    breakdownUnit: 'pct',
    marketplaceSplit: o.marketplaceSplit.map(noProfit),
    products: o.products.map(noProfit),
    orders: o.orders.map(noProfit),
    attention: o.attention.map((a) => (a.kind === 'loss' ? { ...a, amount: null } : a)),
  };
}

export async function dailyOverview(input: { day?: string; marketplace?: string; showProfit: boolean; now?: Date }): Promise<DailyOverview> {
  const now = input.now ?? new Date();
  const day = parseDailyDay(input.day, now);
  const marketplace = parseDailyMarketplace(input.marketplace);
  const isToday = day === shopToday(now);
  const cutoffMinute = isToday ? shopClock(now.getTime()).minuteOfDay : null;
  const before = plusDays(day, -1);
  const weekAgo = plusDays(day, -7);

  const [all, marketplaces, cancelled, refunded, pending] = await Promise.all([
    linesFor([day, before, weekAgo]),
    marketplacesWithAccounts(),
    cancelledOn(day, marketplace),
    refundedOn(day, marketplace),
    pendingOn(day, marketplace),
  ]);
  const ofDay = (d: string) => all.filter((l) => l.day === d);
  const filtered = (list: DailyLine[]) => (marketplace ? list.filter((l) => l.marketplace === marketplace) : list);
  const dayLines = filtered(ofDay(day));
  const beforeLines = filtered(ofDay(before));
  const weekAgoLines = filtered(ofDay(weekAgo));

  const customerIds = [...new Set(dayLines.map((l) => l.customerId).filter((id): id is string => Boolean(id)))];
  const back = await returningCustomers(customerIds, day);
  const dayOrders = byOrder(dayLines);
  const dayProducts = byProduct(dayLines);
  // A buyer the CRM hasn't matched yet counts as new.
  const buyers = new Set(dayLines.map((l) => l.customerId ?? `order:${l.orderId}`));

  const overview: DailyOverview = {
    day,
    isToday,
    cutoffMinute,
    marketplace,
    marketplaces,
    showProfit: true,
    totals: totalsOf(dayLines),
    yesterday: totalsOf(upTo(beforeLines, cutoffMinute)),
    lastWeek: totalsOf(upTo(weekAgoLines, cutoffMinute)),
    lastWeekFullDayOrders: new Set(weekAgoLines.map((l) => l.orderId)).size,
    hours: hourly(dayLines),
    hoursLastWeek: hourly(weekAgoLines),
    breakdown: breakdownOf(dayLines),
    breakdownUnit: 'pln',
    marketplaceSplit: byMarketplace(ofDay(day)),
    products: dayProducts,
    orders: dayOrders,
    customers: { new: buyers.size - back.size, returning: back.size },
    cancelled,
    refunded,
    attention: attentionOf(dayOrders, dayProducts, { cancelled, refunded, pending }),
    lastOrderAt: dayLines.length ? Math.max(...dayLines.map((l) => l.placedAt)) : null,
  };
  return input.showProfit ? overview : withoutProfit(overview);
}
