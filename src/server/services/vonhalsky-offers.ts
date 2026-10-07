// Creating InPost Von Halsky offers from the Shopify product list, and keeping their prices at
// Shopify's price plus a markup. Stock follows the normal stock push once an offer exists.
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { markupPrice } from '../../lib/offers';
import { getDb } from '../db/client';
import { marketplaceAccounts, productListings, products, type MarketplaceSettings } from '../db/schema';
import { VonHalskyAdapter, type VonHalskyOfferInput } from '../integrations/marketplaces/vonhalsky/adapter';
import { ShopifyAdapter, type ShopifyVariantDetails } from '../integrations/marketplaces/shopify/adapter';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { importListings } from './inventory';

/** Prefix of the externalId on offers Luora created; only those get their prices managed. */
export const LUORA_OFFER_PREFIX = 'luora:';

export const DEFAULT_BOX = { width: 10, height: 10, length: 5 };
const DEFAULT_WEIGHT_GRAMS = 300;
const CATEGORY_ROOT = 'Uroda';
const CATEGORIES_TTL_MS = 7 * 86_400_000;

/** Shopify price × markup, rounded as configured (x.99 / x.00 / none). */
export function offerPrice(shopifyPrice: string | number, settings: MarketplaceSettings): string {
  return markupPrice(shopifyPrice, settings.vhMarkupPercent ?? 10, settings.vhRounding ?? 'x.99');
}

const fold = (text: string) =>
  text
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');

/** English/Polish words in Shopify product types and titles that point at an InPost category. */
const SYNONYMS: Record<string, string[]> = {
  cream: ['krem', 'kremy'],
  creams: ['krem', 'kremy'],
  serum: ['serum', 'serie'],
  mask: ['maski', 'maska'],
  sunscreen: ['filtr', 'opalanie'],
  spf: ['filtr', 'opalanie'],
  cleanser: ['oczyszczanie', 'zele', 'pianki'],
  toner: ['toniki', 'tonik'],
  lip: ['usta', 'ust'],
  hair: ['wlos'],
  body: ['cial'],
  face: ['twarz'],
  eye: ['oczu', 'oko'],
  hand: ['dlon'],
};

/** The best leaf for a product type and title, or null when nothing fits. */
export function suggestCategory(productType: string, title: string, categories: { id: string; path: string }[]): { id: string; path: string } | null {
  const words = fold(`${productType} ${title}`).split(/[^a-z0-9]+/).filter((w) => w.length > 2);
  const wanted = new Set(words.flatMap((w) => [w, ...(SYNONYMS[w] ?? [])]));
  let best: { id: string; path: string; score: number } | null = null;
  for (const c of categories) {
    const last = fold(c.path.split(' › ').pop() ?? '');
    const rest = fold(c.path);
    let score = 0;
    for (const w of wanted) {
      if (last.includes(w.slice(0, 5))) score += 3;
      else if (rest.includes(w.slice(0, 5))) score += 1;
    }
    if (score > 0 && (!best || score > best.score)) best = { ...c, score };
  }
  return best && { id: best.id, path: best.path };
}

export interface OfferRow {
  productId: string;
  variantId: string;
  name: string;
  ean: string | null;
  imageUrl: string | null;
  productType: string;
  shopifyPrice: string | null;
  price: string | null;
  stock: number;
  categoryId: string | null;
  categoryPath: string | null;
  /** True when the category came from a saved choice rather than a suggestion. */
  categoryChosen: boolean;
  problems: string[];
}

async function shopifyAdapter(): Promise<ShopifyAdapter> {
  const [account] = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.type, 'shopify'), eq(marketplaceAccounts.enabled, true)))
    .limit(1);
  if (!account) throw new Error('There is no Shopify account');
  const adapter = getMarketplaceAdapter(account);
  if (!(adapter instanceof ShopifyAdapter)) throw new Error('Shopify adapter is not available (demo mode?)');
  return adapter;
}

function vonHalsky(account: Awaited<ReturnType<typeof loadMarketplaceAccount>>): VonHalskyAdapter {
  const adapter = getMarketplaceAdapter(account);
  if (!(adapter instanceof VonHalskyAdapter)) throw new Error('This is not a Von Halsky account');
  return adapter;
}

/** Reads the cosmetics categories from InPost once a week and keeps them in the account settings. */
export async function loadCategories(accountId: string, force = false): Promise<{ id: string; path: string }[]> {
  const account = await loadMarketplaceAccount(accountId);
  const cached = account.settings.vhCategories;
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < CATEGORIES_TTL_MS) return cached.items;
  const items = await vonHalsky(account).categoryLeaves(CATEGORY_ROOT);
  await getDb()
    .update(marketplaceAccounts)
    .set({ settings: { ...account.settings, vhCategories: { fetchedAt: new Date().toISOString(), items } } })
    .where(eq(marketplaceAccounts.id, accountId));
  return items;
}

/** Shopify products that have no offer in this account yet, with what would be sent. */
export async function offerPreview(accountId: string): Promise<OfferRow[]> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const settings = account.settings;
  const categories = settings.vhCategories?.items ?? [];

  const items = await db
    .select({ id: products.id, name: products.name, ean: products.ean, sku: products.sku, stock: products.stock, imageUrl: products.imageUrl, variantId: products.shopifyVariantId })
    .from(products)
    .where(isNotNull(products.shopifyVariantId))
    .orderBy(asc(products.name));
  const listings = await db
    .select({ productId: productListings.productId, ean: productListings.ean })
    .from(productListings)
    .where(eq(productListings.accountId, accountId));
  const linked = new Set(listings.map((l) => l.productId).filter(Boolean));
  const eans = new Set(listings.map((l) => l.ean).filter(Boolean));
  const missing = items.filter((p) => !linked.has(p.id) && !(p.ean && eans.has(p.ean)));
  if (missing.length === 0) return [];

  const details = await (await shopifyAdapter()).variantDetails(missing.map((p) => p.variantId!));
  return missing.map((p): OfferRow => {
    const d = details.get(p.variantId!);
    const productType = d?.productType ?? '';
    const saved = settings.vhCategoryMap?.[productType];
    const picked = saved ? categories.find((c) => c.id === saved) ?? { id: saved, path: saved } : null;
    const chosen = picked ?? suggestCategory(productType, d?.title ?? p.name, categories);
    const problems: string[] = [];
    if (!d) problems.push('not found in Shopify');
    if (!p.ean) problems.push('no EAN');
    if (d && d.imageUrls.length === 0) problems.push('no photo');
    if (d && !d.descriptionHtml.trim()) problems.push('no description');
    if (d && !d.vendor.trim()) problems.push('no brand');
    if (!chosen) problems.push(categories.length ? 'no category' : 'load the categories first');
    return {
      productId: p.id,
      variantId: p.variantId!,
      name: d?.title ?? p.name,
      ean: p.ean,
      imageUrl: p.imageUrl,
      productType,
      shopifyPrice: d?.price ?? null,
      price: d ? offerPrice(d.price, settings) : null,
      stock: p.stock,
      categoryId: chosen?.id ?? null,
      categoryPath: chosen?.path ?? null,
      categoryChosen: Boolean(picked),
      problems,
    };
  });
}

export function toOfferInput(row: OfferRow, d: ShopifyVariantDetails, settings: MarketplaceSettings): VonHalskyOfferInput {
  const box = settings.vhBox ?? DEFAULT_BOX;
  return {
    externalId: `${LUORA_OFFER_PREFIX}${row.productId}`,
    name: d.title,
    descriptionHtml: d.descriptionHtml,
    brand: d.vendor,
    categoryId: row.categoryId!,
    sku: d.sku,
    ean: row.ean!,
    dimension: { ...box, weight: d.weightGrams ?? DEFAULT_WEIGHT_GRAMS },
    quantity: row.stock,
    price: row.price!,
    currency: 'PLN',
    daysToShip: settings.vhDaysToShip ?? 1,
    imageUrls: d.imageUrls.slice(0, 10),
  };
}

export interface CreateResult {
  created: string[];
  failed: { name: string; error: string }[];
}

/** Creates offers for the chosen products (only those that are ready), then imports them so stock can follow. */
export async function createOffers(accountId: string, productIds: string[]): Promise<CreateResult> {
  const account = await loadMarketplaceAccount(accountId);
  const adapter = vonHalsky(account);
  const wanted = new Set(productIds);
  const rows = (await offerPreview(accountId)).filter((r) => wanted.has(r.productId));
  const details = await (await shopifyAdapter()).variantDetails(rows.map((r) => r.variantId));
  const result: CreateResult = { created: [], failed: [] };
  for (const row of rows) {
    const d = details.get(row.variantId);
    if (row.problems.length || !d) {
      result.failed.push({ name: row.name, error: `not ready: ${row.problems.join(', ') || 'missing data'}` });
      continue;
    }
    try {
      await adapter.createOffer(toOfferInput(row, d, account.settings));
      result.created.push(row.name);
    } catch (err) {
      result.failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.created.length) await importListings(accountId);
  return result;
}

/** Remembers the category chosen for a Shopify product type. */
export async function saveCategoryChoice(accountId: string, productType: string, categoryId: string): Promise<void> {
  const account = await loadMarketplaceAccount(accountId);
  const map = { ...(account.settings.vhCategoryMap ?? {}), [productType]: categoryId };
  await getDb()
    .update(marketplaceAccounts)
    .set({ settings: { ...account.settings, vhCategoryMap: map } })
    .where(eq(marketplaceAccounts.id, accountId));
}

/** Sets offers Luora created to Shopify's price + markup where InPost shows another price. */
export async function syncOfferPrices(accountId: string): Promise<{ updated: number }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const rows = await db
    .select({ externalId: productListings.externalId, ref: productListings.ref, variantId: products.shopifyVariantId })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    .where(and(eq(productListings.accountId, accountId), isNotNull(products.shopifyVariantId)));
  const ours = rows.filter((r) => String(r.ref.externalId ?? '').startsWith(LUORA_OFFER_PREFIX));
  if (ours.length === 0) return { updated: 0 };
  const details = await (await shopifyAdapter()).variantDetails(ours.map((r) => r.variantId!));
  const updates = ours.flatMap((r) => {
    const d = details.get(r.variantId!);
    if (!d) return [];
    const price = offerPrice(d.price, account.settings);
    return Math.abs(Number(price) - Number(r.ref.price ?? -1)) < 0.005 ? [] : [{ offerId: r.externalId, price, currency: 'PLN' }];
  });
  if (updates.length === 0) return { updated: 0 };
  await vonHalsky(account).updatePrices(updates);
  await importListings(accountId);
  return { updated: updates.length };
}
