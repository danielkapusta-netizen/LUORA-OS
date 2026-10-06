// Turns stored profit lines (sales_lines) into the business model the Luora Analytics domain
// modules work on (src/lib/analytics). This replaces the old Google Sheet loader: every figure
// now comes from the marketplaces' APIs and the costs entered in Settings.
import { eq, sql } from 'drizzle-orm';
import { buildChannelPerformance, buildComparison, buildCoverage, buildProductPerformance, buildSeries } from '@/lib/analytics/metrics';
import { ratio, sum } from '@/lib/analytics/parse';
import { resolvePeriod, type CustomRange, type PeriodKey, type ResolvedPeriod } from '@/lib/analytics/period';
import { buildSnapshot, type Snapshot } from '@/lib/analytics/snapshot';
import type {
  Channel,
  ChannelPerformance,
  DailyPoint,
  DataCoverage,
  LineItem,
  Order,
  PeriodComparison,
  ProductCost,
  ProductPerformance,
} from '@/lib/analytics/types';
import { cleanShopifyTitle } from '@/lib/sku';
import { getDb } from '../db/client';
import { orderItems, orders, products, salesLines } from '../db/schema';
import { currentCosts } from '../services/costs';

export interface BusinessData {
  lineItems: LineItem[];
  orders: Order[];
  costs: ProductCost[];
  daily: DailyPoint[];
  products: ProductPerformance[];
  channels: ChannelPerformance[];
  comparison: PeriodComparison;
  coverage: DataCoverage;
  /** Lines whose marketplace fee is still the fallback estimate. */
  estimatedFeeLines: number;
}

export interface DatasetFilter {
  marketplace?: Channel;
}

interface Row {
  itemId: string;
  orderId: string;
  marketplace: Channel;
  productId: string | null;
  placedAt: number;
  currency: string;
  fxRate: number;
  vatRate: number;
  quantity: number;
  gross: number;
  fees: number;
  feesEstimated: number;
  cost: number;
  costKnown: number;
  shipping: number;
  delivery: number;
  profit: number;
  unitPrice: string;
  itemName: string;
  sku: string | null;
  productName: string | null;
  brand: string | null;
  category: string | null;
  externalNumber: string;
  buyerName: string | null;
}

/** One line in the shape the domain modules expect. Lines without a product are keyed by their SKU or name. */
export function toLineItem(r: Row): LineItem {
  const key = r.productId ?? `item:${(r.sku || r.itemName).toLowerCase()}`;
  const label = r.productName ? cleanShopifyTitle(r.productName) : r.itemName;
  const fx = r.fxRate || 1;
  return {
    id: r.itemId,
    rawSku: key,
    productKey: key,
    productLabel: label,
    qty: r.quantity,
    currency: r.currency,
    priceOriginal: Number(r.unitPrice),
    netPriceOriginal: Number(r.unitPrice) / (1 + r.vatRate),
    commissionOriginal: r.fees / fx,
    shipmentOriginal: (r.delivery - r.shipping) / fx,
    fxRate: fx,
    revenuePLN: r.gross,
    commissionPLN: r.fees,
    // Net cost of getting the parcel out: labels, packaging and delivery charges less what the buyer paid.
    shipmentPLN: r.delivery - r.shipping,
    marginPLN: r.profit,
    marginPct: r.gross > 0 ? (r.profit / r.gross) * 100 : null,
    customerName: r.buyerName ?? '',
    source: r.marketplace,
    date: new Date(r.placedAt),
    isComplete: true,
    orderKey: r.orderId,
    brand: r.brand,
    category: r.category,
    costPLN: r.cost,
    costKnown: Boolean(r.costKnown),
    feesEstimated: Boolean(r.feesEstimated),
    orderId: r.orderId,
    orderNumber: r.externalNumber,
  };
}

/** Groups lines into orders (newest first). Real order ids, so no de-duplication is needed. */
export function groupOrders(lines: LineItem[]): Order[] {
  const byOrder = new Map<string, LineItem[]>();
  for (const line of lines) byOrder.set(line.orderKey, [...(byOrder.get(line.orderKey) ?? []), line]);
  const out: Order[] = [];
  for (const [id, items] of byOrder) {
    const first = items[0];
    const revenue = sum(items, (i) => i.revenuePLN);
    const margin = sum(items, (i) => i.marginPLN);
    out.push({
      id,
      date: first.date,
      customerName: first.customerName,
      source: first.source,
      items,
      lineCount: items.length,
      units: sum(items, (i) => i.qty),
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: revenue > 0 ? ratio(margin, revenue) * 100 : null,
      commissionPLN: sum(items, (i) => i.commissionPLN),
      shipmentPLN: sum(items, (i) => i.shipmentPLN),
      isComplete: true,
      hasSuspectedMissingLine: false,
    });
  }
  return out.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0));
}

async function loadRows(filter: DatasetFilter): Promise<Row[]> {
  return getDb().all<Row>(sql`
    select l.item_id as itemId, l.order_id as orderId, l.marketplace, l.product_id as productId, l.placed_at as placedAt,
      l.currency, l.fx_rate as fxRate, l.vat_rate as vatRate, l.quantity, l.gross, l.fees, l.fees_estimated as feesEstimated,
      l.cost, l.cost_known as costKnown, l.shipping, l.delivery, l.profit,
      i.unit_price as unitPrice, i.name as itemName, i.sku, p.name as productName, p.brand, p.category,
      o.external_number as externalNumber, json_extract(o.buyer, '$.name') as buyerName
    from ${salesLines} l
      join ${orderItems} i on i.id = l.item_id
      join ${orders} o on o.id = l.order_id
      left join ${products} p on p.id = l.product_id
    ${filter.marketplace ? sql`where l.marketplace = ${filter.marketplace}` : sql``}
    order by l.placed_at desc`);
}

/** Current landed costs, keyed like the lines (by product id). */
async function loadCosts(): Promise<ProductCost[]> {
  const costs = await currentCosts();
  const names = new Map((await getDb().select({ id: products.id, name: products.name }).from(products)).map((p) => [p.id, p.name]));
  return [...costs].map(([productId, c]) => ({
    rawSku: productId,
    productKey: productId,
    productLabel: cleanShopifyTitle(names.get(productId) ?? ''),
    totalCostPLN: Number(c.unitCost),
    costEUR: null,
    costUSD: null,
    costPLN: c.purchaseCurrency === 'PLN' && c.purchasePrice ? Number(c.purchasePrice) : null,
    shipmentUSD: null,
    higherMoq: null,
  }));
}

export async function loadBusinessData(filter: DatasetFilter = {}): Promise<BusinessData> {
  const [rows, costs] = await Promise.all([loadRows(filter), loadCosts()]);
  const lineItems = rows.map(toLineItem);
  const allOrders = groupOrders(lineItems);
  const daily = buildSeries(allOrders, 'day');
  return {
    lineItems,
    orders: allOrders,
    costs,
    daily,
    products: buildProductPerformance(allOrders, costs),
    channels: buildChannelPerformance(allOrders),
    comparison: buildComparison(daily),
    coverage: {
      ...buildCoverage(allOrders, costs),
      // A line knows its own cost (from the day it was sold), which is what profit used.
      ...lineCostCoverage(lineItems),
    },
    estimatedFeeLines: lineItems.filter((l) => l.feesEstimated).length,
  };
}

function lineCostCoverage(lines: LineItem[]): Pick<DataCoverage, 'linesMissingCost' | 'revenueMissingCostPLN' | 'costCoverage'> {
  const missing = lines.filter((l) => !l.costKnown);
  const total = sum(lines, (l) => l.revenuePLN);
  const missingRevenue = sum(missing, (l) => l.revenuePLN);
  return { linesMissingCost: missing.length, revenueMissingCostPLN: missingRevenue, costCoverage: total > 0 ? 1 - missingRevenue / total : 1 };
}

export const PERIOD_KEYS: PeriodKey[] = ['today', 'yesterday', 'week', 'month', 'quarter', 'year', 'all', 'custom'];

export function parsePeriodKey(value: string | undefined, fallback: PeriodKey = 'month'): PeriodKey {
  return PERIOD_KEYS.includes(value as PeriodKey) ? (value as PeriodKey) : fallback;
}

/** The period a page shows, anchored to today (Luora OS data is live). */
export function periodFor(data: BusinessData, key: PeriodKey, custom?: CustomRange, now = new Date()): ResolvedPeriod {
  return resolvePeriod(key, now, data.coverage.firstOrder, custom, now);
}

export function snapshotFor(data: BusinessData, period: ResolvedPeriod): Snapshot {
  return buildSnapshot({ allOrders: data.orders, costs: data.costs, period, coverage: data.coverage, comparison: data.comparison });
}

/** Units sold and profit per product over the last `days` days, for the Inventory page. */
export async function productMargins(days = 30): Promise<Map<string, { units: number; gross: number; profit: number }>> {
  const since = Date.now() - days * 86_400_000;
  const rows = await getDb()
    .select({
      productId: salesLines.productId,
      units: sql<number>`sum(${salesLines.quantity})`,
      gross: sql<number>`sum(${salesLines.gross})`,
      profit: sql<number>`sum(${salesLines.profit})`,
    })
    .from(salesLines)
    .where(sql`${salesLines.placedAt} >= ${since} and ${salesLines.productId} is not null`)
    .groupBy(salesLines.productId);
  return new Map(rows.map((r) => [r.productId!, { units: r.units, gross: r.gross, profit: r.profit }]));
}

/** Profit lines of one order, for the order page. */
export async function orderProfit(orderId: string) {
  return getDb().select().from(salesLines).where(eq(salesLines.orderId, orderId));
}
