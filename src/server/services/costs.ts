// Product landed costs and the profit settings (fallback commissions, label costs, margin targets).
// Costs are kept per product as dated entries: a new purchase price applies from its date on and
// never changes the margin of earlier sales.
import { and, asc, desc, eq, inArray, lte, sql } from 'drizzle-orm';
import { chunk, getDb } from '../db/client';
import { analyticsSettings, marketplaceAccounts, productCosts, products, type AnalyticsSettings, type Product, type ProductCost } from '../db/schema';
import { isMockMode } from '../env';
import { request } from '../http';
import { ShopifyAdapter } from '../integrations/marketplaces/shopify/adapter';
import { normalizeEan } from '@/lib/sku';
import { getMarketplaceAdapter } from './accounts';
import { plnRateOn, today } from './fx';
import { createMatcher, isClearSuggestion } from './matching';

// ---------------------------------------------------------------- settings

export const DEFAULT_ANALYTICS_SETTINGS: Required<AnalyticsSettings> = {
  fallbackCommission: { allegro: 0.12, empik: 0.15, shopify: 0.02, vonhalsky: 0.1 },
  labelCosts: { inpost_locker_standard: 12.5, inpost_courier_standard: 15.5, allegro_shipping: 11 },
  defaultLabelCost: 12.5,
  packagingCost: 1.5,
  feesVatDeductible: true,
  targetMargin: 0.18,
  healthyMargin: 0.15,
  thinMargin: 0.1,
  criticalMargin: 0.05,
};

/** Label services that have their own cost, with how staff know them. */
export const LABEL_COST_SERVICES = [
  { key: 'inpost_locker_standard', label: 'InPost Paczkomat label' },
  { key: 'inpost_courier_standard', label: 'InPost courier label' },
  { key: 'allegro_shipping', label: 'Allegro Delivery label', hint: 'Used only when Allegro billing has no delivery charge for the order.' },
] as const;

export async function loadAnalyticsSettings(): Promise<Required<AnalyticsSettings>> {
  const [row] = await getDb().select().from(analyticsSettings).where(eq(analyticsSettings.id, 'main'));
  const s = row?.settings ?? {};
  const d = DEFAULT_ANALYTICS_SETTINGS;
  return {
    ...d,
    ...s,
    fallbackCommission: { ...d.fallbackCommission, ...s.fallbackCommission },
    labelCosts: { ...d.labelCosts, ...s.labelCosts },
  };
}

export async function saveAnalyticsSettings(settings: AnalyticsSettings): Promise<void> {
  const { healthyMargin, thinMargin, criticalMargin } = { ...DEFAULT_ANALYTICS_SETTINGS, ...settings };
  if (!(criticalMargin < thinMargin && thinMargin < healthyMargin)) {
    throw new Error('Margin bands must rise: critical < thin < healthy');
  }
  await getDb()
    .insert(analyticsSettings)
    .values({ id: 'main', settings })
    .onConflictDoUpdate({ target: analyticsSettings.id, set: { settings, updatedAt: new Date() } });
}

// ---------------------------------------------------------------- costs

/** Parses "12,50" / "12.5" / "1 234,5 zł" into a number; null when empty or not a number. */
export function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const clean = String(value ?? '')
    .replace(/[^\d,.-]/g, '')
    .replace(/,(?=\d{1,2}$)/, '.')
    .replace(/,/g, '');
  if (!clean || clean === '-' || clean === '.') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

export interface CostInput {
  /** Landed unit cost in PLN; worked out from the parts when left empty. */
  unitCost?: number | null;
  purchasePrice?: number | null;
  purchaseCurrency?: string | null;
  freight?: number | null;
  duty?: number | null;
  effectiveFrom?: string | null;
  note?: string | null;
}

/** Landed cost in PLN: purchase price at the NBP rate of the day, plus freight and duty. */
export async function landedCost(input: CostInput, day: string): Promise<number> {
  if (input.unitCost != null) return input.unitCost;
  if (input.purchasePrice == null) throw new Error('Enter the unit cost, or the purchase price');
  const currency = (input.purchaseCurrency || 'PLN').toUpperCase();
  const rate = await plnRateOn(currency, day);
  if (rate === null) throw new Error(`No NBP rate for ${currency} on ${day}; enter the cost in PLN`);
  return input.purchasePrice * rate + (input.freight ?? 0) + (input.duty ?? 0);
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export async function setProductCost(productId: string, input: CostInput, userId: string | null, source = 'manual'): Promise<ProductCost> {
  const effectiveFrom = input.effectiveFrom?.trim() || '2000-01-01';
  if (!DAY.test(effectiveFrom)) throw new Error('The date must look like 2026-10-01');
  const unitCost = await landedCost(input, effectiveFrom === '2000-01-01' ? today() : effectiveFrom);
  if (!(unitCost >= 0)) throw new Error('The cost cannot be negative');
  const values = {
    unitCost: unitCost.toFixed(4),
    purchasePrice: input.purchasePrice != null ? String(input.purchasePrice) : null,
    purchaseCurrency: input.purchasePrice != null ? (input.purchaseCurrency || 'PLN').toUpperCase() : null,
    freight: input.freight != null ? String(input.freight) : null,
    duty: input.duty != null ? String(input.duty) : null,
    source,
    note: input.note?.trim() || null,
    createdBy: userId,
  };
  const [row] = await getDb()
    .insert(productCosts)
    .values({ productId, effectiveFrom, ...values })
    .onConflictDoUpdate({ target: [productCosts.productId, productCosts.effectiveFrom], set: values })
    .returning();
  return row;
}

export async function deleteProductCost(costId: string): Promise<void> {
  await getDb().delete(productCosts).where(eq(productCosts.id, costId));
}

export async function costHistory(productId: string): Promise<ProductCost[]> {
  return getDb().select().from(productCosts).where(eq(productCosts.productId, productId)).orderBy(desc(productCosts.effectiveFrom));
}

/** The cost in force on `day` for each product (latest entry on or before it). */
export async function currentCosts(productIds?: string[], day = today()): Promise<Map<string, ProductCost>> {
  const db = getDb();
  const rows = productIds
    ? (
        await Promise.all(
          chunk(productIds).map((ids) =>
            db.select().from(productCosts).where(and(inArray(productCosts.productId, ids), lte(productCosts.effectiveFrom, day))),
          ),
        )
      ).flat()
    : await db.select().from(productCosts).where(lte(productCosts.effectiveFrom, day));
  const out = new Map<string, ProductCost>();
  for (const r of rows) {
    const seen = out.get(r.productId);
    if (!seen || seen.effectiveFrom < r.effectiveFrom) out.set(r.productId, r);
  }
  return out;
}

export interface CostRow {
  product: Pick<Product, 'id' | 'sku' | 'name' | 'imageUrl' | 'ean' | 'brand' | 'category' | 'stock'>;
  cost: ProductCost | null;
  /** Entries in the cost history. */
  entries: number;
  /** Units and gross revenue in PLN over the last 90 days (from the order lines, not refunded). */
  units90: number;
  revenue90: number;
}

export function filterCostRows(rows: CostRow[], filter: { q?: string; missing?: boolean }): CostRow[] {
  const q = filter.q?.trim().toLowerCase();
  return rows
    .filter((r) => !q || `${r.product.name} ${r.product.sku} ${r.product.ean ?? ''} ${r.product.brand ?? ''}`.toLowerCase().includes(q))
    .filter((r) => !filter.missing || !r.cost);
}

/** Products with their current cost and recent sales, best sellers first. */
export async function listCostRows(): Promise<CostRow[]> {
  const db = getDb();
  const all = await db
    .select({
      id: products.id,
      sku: products.sku,
      name: products.name,
      imageUrl: products.imageUrl,
      ean: products.ean,
      brand: products.brand,
      category: products.category,
      stock: products.stock,
    })
    .from(products)
    .orderBy(asc(products.name));
  const since = Date.now() - 90 * 86_400_000;
  const sales = await db.all<{ productId: string; units: number; revenue: number }>(sql`
    select i.product_id as productId, sum(i.quantity) as units,
      sum((cast(i.unit_price as real) * i.quantity - coalesce(cast(i.discount_amount as real), 0))
        * coalesce((select r.rate from fx_rates r where r.currency = o.currency and r.day <= date(o.placed_at / 1000, 'unixepoch') order by r.day desc limit 1),
                   case when o.currency = 'PLN' then 1 else 0 end)) as revenue
    from order_items i join orders o on o.id = i.order_id
    where i.product_id is not null and o.status <> 'cancelled' and o.placed_at >= ${since}
    group by i.product_id`);
  const byProduct = new Map(sales.map((s) => [s.productId, s]));
  const costs = await currentCosts();
  const counts = new Map(
    (await db.select({ productId: productCosts.productId, n: sql<number>`count(*)` }).from(productCosts).groupBy(productCosts.productId)).map((r) => [
      r.productId,
      r.n,
    ]),
  );
  return all
    .map((p) => ({
      product: p,
      cost: costs.get(p.id) ?? null,
      entries: counts.get(p.id) ?? 0,
      units90: byProduct.get(p.id)?.units ?? 0,
      revenue90: byProduct.get(p.id)?.revenue ?? 0,
    }))
    .sort((a, b) => b.revenue90 - a.revenue90 || a.product.name.localeCompare(b.product.name));
}

// ---------------------------------------------------------------- bulk import

export interface ImportLine {
  /** SKU, EAN or product name as written in the source. */
  key: string;
  cost: number;
}

export interface ImportResult {
  saved: number;
  /** Lines that matched no product clearly enough. */
  unmatched: string[];
  /** Sheet rows for bundles of several products, left out. */
  skippedBundles?: number;
}

/**
 * Parses pasted rows: "key;cost", "key<TAB>cost" or "key,cost" (the last number on the line is
 * the cost). A header line without a number is skipped.
 */
export function parseCostLines(text: string): ImportLine[] {
  const out: ImportLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(/\t|;/).map((p) => p.trim().replace(/^"|"$/g, ''));
    let key: string;
    let cost: number | null;
    if (parts.length >= 2) {
      cost = parseAmount(parts.at(-1));
      key = parts.slice(0, -1).join(' ').trim();
    } else {
      // "key,12.50": split on the last comma that precedes a number.
      const m = line.match(/^(.*?)[,\s]+(-?[\d\s]+(?:[.,]\d+)?)\s*(?:zł|pln)?$/i);
      key = m?.[1]?.trim() ?? '';
      cost = m ? parseAmount(m[2]) : null;
    }
    if (key && cost !== null && cost >= 0) out.push({ key, cost });
  }
  return out;
}

/** Finds the product a line names: exact SKU, then EAN, then a clear match on the name. */
export function createProductResolver(list: Pick<Product, 'id' | 'sku' | 'name' | 'ean'>[]) {
  const bySku = new Map(list.map((p) => [p.sku.toLowerCase(), p.id]));
  const byEan = new Map(list.filter((p) => p.ean).map((p) => [p.ean!, p.id]));
  const suggest = createMatcher(list.map((p) => ({ id: p.id, name: p.name })));
  return (key: string): string | null => {
    const sku = bySku.get(key.trim().toLowerCase());
    if (sku) return sku;
    const ean = normalizeEan(key);
    if (ean && byEan.has(ean)) return byEan.get(ean)!;
    // Cost sheets name products like marketplace listings: drop offer ids "(18505316304)" and pack words.
    const title = key.replace(/\(\d{6,}\)/g, ' ').replace(/\b\d*\s*(sztuk[ai]?|szt\.?|opak\.?)\s*$/i, ' ');
    const suggestions = suggest(title);
    return isClearSuggestion(suggestions) ? suggestions[0].productId : null;
  };
}

export async function importCosts(lines: ImportLine[], options: { effectiveFrom?: string; userId: string | null; source: string }): Promise<ImportResult> {
  const list = await getDb().select({ id: products.id, sku: products.sku, name: products.name, ean: products.ean }).from(products);
  const resolve = createProductResolver(list);
  const result: ImportResult = { saved: 0, unmatched: [] };
  const seen = new Set<string>();
  for (const line of lines) {
    const productId = resolve(line.key);
    if (!productId) {
      result.unmatched.push(line.key);
      continue;
    }
    // The first line for a product wins (sheets sometimes list a product twice).
    if (seen.has(productId)) continue;
    seen.add(productId);
    await setProductCost(productId, { unitCost: line.cost, effectiveFrom: options.effectiveFrom }, options.userId, options.source);
    result.saved++;
  }
  return result;
}

/**
 * One-off import from the Luora Analytics Google Sheet: its Apps Script answers
 * `?action=productCosts` with the cost tab, where `totalCost` is the landed cost in PLN.
 */
export async function importCostsFromSheet(url: string, options: { effectiveFrom?: string; userId: string | null }): Promise<ImportResult> {
  const endpoint = new URL(url.trim());
  if (endpoint.protocol !== 'https:') throw new Error('The sheet URL must start with https://');
  endpoint.searchParams.set('action', 'productCosts');
  const { data } = await request<string>(endpoint.toString(), { responseType: 'text', timeoutMs: 30_000 });
  let rows: unknown;
  try {
    rows = JSON.parse(data);
  } catch {
    throw new Error('The sheet answered with a page instead of data. Check the Apps Script URL (it ends with /exec).');
  }
  if (!Array.isArray(rows)) throw new Error('The sheet returned no cost rows');
  const lines = rows
    .map((r: { sku?: unknown; totalCost?: unknown }) => ({ key: String(r.sku ?? '').trim(), cost: parseAmount(r.totalCost) }))
    .filter((l): l is ImportLine => Boolean(l.key) && l.cost !== null && l.cost > 0);
  // "Product A; Product B" rows are bundles: their cost belongs to no single product.
  const bundles = lines.filter((l) => l.key.includes(';'));
  const result = await importCosts(
    lines.filter((l) => !l.key.includes(';')),
    { ...options, source: 'sheet' },
  );
  return { ...result, skippedBundles: bundles.length };
}

/** Shopify's "Cost per item" of each variant, in PLN, for products that have no cost yet (or all, with `overwrite`). */
export async function importCostsFromShopify(options: { userId: string | null; overwrite?: boolean }): Promise<ImportResult & { skipped: number }> {
  const db = getDb();
  const accounts = await db.select().from(marketplaceAccounts).where(and(eq(marketplaceAccounts.type, 'shopify'), eq(marketplaceAccounts.enabled, true)));
  if (!accounts.length) throw new Error('No Shopify account is connected');
  const known = await currentCosts();
  const variants = await db.select({ id: products.id, variantId: products.shopifyVariantId }).from(products);
  const byVariant = new Map(variants.filter((v) => v.variantId).map((v) => [v.variantId!, v.id]));
  const result = { saved: 0, unmatched: [] as string[], skipped: 0 };
  for (const account of accounts) {
    const adapter = getMarketplaceAdapter(account);
    const costs = isMockMode() || !(adapter instanceof ShopifyAdapter) ? new Map<string, { amount: string; currency: string }>() : await adapter.variantCosts();
    for (const [variantId, cost] of costs) {
      const productId = byVariant.get(variantId);
      if (!productId) continue;
      if (known.has(productId) && !options.overwrite) {
        result.skipped++;
        continue;
      }
      await setProductCost(
        productId,
        { purchasePrice: Number(cost.amount), purchaseCurrency: cost.currency, effectiveFrom: known.has(productId) ? today() : null },
        options.userId,
        'shopify',
      );
      result.saved++;
    }
  }
  return result;
}
