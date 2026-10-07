// Creating offers on Allegro and Empik from the Shopify product list. Only products the marketplace catalogue
// already knows (by EAN) are offered; the offer's price is Shopify's price plus a markup. Once an offer exists,
// importing the account's listings links it to the product and the normal stock sync takes over.
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { markupPrice } from '../../lib/offers';
import { getDb } from '../db/client';
import { marketplaceAccounts, productListings, products, type MarketplaceSettings } from '../db/schema';
import { isMockMode } from '../env';
import { ShopifyAdapter, type ShopifyVariantDetails } from '../integrations/marketplaces/shopify/adapter';
import { isOfferPublisher, type CatalogueMatch, type OfferDraft, type OfferPublisher } from '../integrations/marketplaces/types';
import { MOCK_CATALOG } from '../integrations/marketplaces/mock/adapter';
import { AllegroAdapter } from '../integrations/marketplaces/allegro/adapter';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { importListings } from './inventory';

export const MAX_OFFERS_PER_RUN = 25;

export function publishPrice(shopifyPrice: string | number, settings: MarketplaceSettings): string {
  return markupPrice(shopifyPrice, settings.offerMarkupPercent ?? 0, settings.offerRounding ?? 'x.99');
}

async function shopifyDetails(variantIds: string[], rows: { variantId: string | null; name: string; brand: string | null; imageUrl: string | null; sku: string }[]): Promise<Map<string, ShopifyVariantDetails>> {
  if (isMockMode()) {
    // Demo mode has no Shopify: describe the products from what the database knows.
    return new Map(
      rows.flatMap((p) =>
        p.variantId
          ? [
              [
                p.variantId,
                {
                  variantId: p.variantId,
                  title: p.name,
                  descriptionHtml: '<p>Demo product</p>',
                  vendor: p.brand ?? 'Demo',
                  productType: '',
                  price: String(MOCK_CATALOG.find((c) => c.sku === p.sku)?.price ?? '49.99'),
                  ean: null,
                  sku: p.sku,
                  imageUrls: p.imageUrl ? [p.imageUrl] : [],
                  weightGrams: null,
                } as unknown as ShopifyVariantDetails,
              ] as const,
            ]
          : [],
      ),
    );
  }
  const [account] = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.type, 'shopify'), eq(marketplaceAccounts.enabled, true)))
    .limit(1);
  if (!account) throw new Error('There is no Shopify account');
  const adapter = getMarketplaceAdapter(account);
  if (!(adapter instanceof ShopifyAdapter)) throw new Error('Shopify adapter is not available');
  return adapter.variantDetails(variantIds);
}

function publisher(account: Awaited<ReturnType<typeof loadMarketplaceAccount>>): OfferPublisher {
  if (account.type !== 'allegro' && account.type !== 'empik') throw new Error('Offers can be created here for Allegro and Empik accounts');
  const adapter = getMarketplaceAdapter(account);
  if (!isOfferPublisher(adapter)) throw new Error('This account cannot create offers');
  return adapter;
}

export type CatalogueState = 'found' | 'missing' | 'unverified';

export interface PublishRow {
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  ean: string | null;
  imageUrl: string | null;
  shopifyPrice: string | null;
  price: string | null;
  stock: number;
  catalogue: CatalogueState | null;
  problems: string[];
}

export interface PublishPreview {
  rows: PublishRow[];
  /** What is missing in the account's settings; nothing can be created until it is fixed. */
  setupProblems: string[];
}

type Loaded = { row: PublishRow; match: CatalogueMatch | null; details: ShopifyVariantDetails | null };

async function loadRows(accountId: string, onlyIds?: Set<string>): Promise<{ rows: Loaded[]; setupProblems: string[]; settings: MarketplaceSettings }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const pub = publisher(account);
  const setupProblems = pub.publishSetupProblems();

  const items = await db
    .select({ id: products.id, name: products.name, ean: products.ean, sku: products.sku, stock: products.stock, imageUrl: products.imageUrl, brand: products.brand, variantId: products.shopifyVariantId })
    .from(products)
    .where(isNotNull(products.shopifyVariantId))
    .orderBy(asc(products.name));
  const listings = await db.select({ productId: productListings.productId, ean: productListings.ean, sku: productListings.sku }).from(productListings).where(eq(productListings.accountId, accountId));
  const linked = new Set(listings.map((l) => l.productId).filter(Boolean));
  const eans = new Set(listings.map((l) => l.ean).filter(Boolean));
  const skus = new Set(listings.map((l) => l.sku?.toLowerCase()).filter(Boolean));
  const missing = items.filter((p) => !linked.has(p.id) && !(p.ean && eans.has(p.ean)) && !skus.has(p.sku.toLowerCase()) && (!onlyIds || onlyIds.has(p.id)));
  if (missing.length === 0) return { rows: [], setupProblems, settings: account.settings };

  const details = await shopifyDetails(missing.map((p) => p.variantId!), missing);
  const wanted = [...new Set(missing.map((p) => p.ean).filter((e): e is string => Boolean(e)))];
  const catalogue = wanted.length ? await pub.checkCatalogue(wanted) : new Map<string, CatalogueMatch>();

  const rows = missing.map((p): Loaded => {
    const d = details.get(p.variantId!) ?? null;
    const match = p.ean ? catalogue.get(p.ean) ?? null : null;
    const problems: string[] = [];
    if (!d) problems.push('not found in Shopify');
    if (!p.ean) problems.push('no EAN');
    else if (match && !match.found) problems.push('not in the catalogue');
    if (d && Number(d.price) <= 0) problems.push('no price');
    return {
      details: d,
      match,
      row: {
        productId: p.id,
        variantId: p.variantId!,
        sku: p.sku,
        name: d?.title ?? p.name,
        ean: p.ean,
        imageUrl: p.imageUrl,
        shopifyPrice: d?.price ?? null,
        price: d ? publishPrice(d.price, account.settings) : null,
        stock: p.stock,
        catalogue: !p.ean || !match ? null : !match.found ? 'missing' : match.unverified ? 'unverified' : 'found',
        problems,
      },
    };
  });
  return { rows, setupProblems, settings: account.settings };
}

/** Shopify products that have no offer in this account yet, with what would be sent. */
export async function publishPreview(accountId: string): Promise<PublishPreview> {
  const { rows, setupProblems } = await loadRows(accountId);
  return { rows: rows.map((r) => r.row), setupProblems };
}

export interface PublishResult {
  created: string[];
  failed: { name: string; error: string }[];
  notes: string[];
}

/** Creates offers for the chosen products (only those that are ready), then imports the listings so stock can follow. */
export async function publishOffers(accountId: string, productIds: string[]): Promise<PublishResult> {
  if (productIds.length === 0) throw new Error('Choose at least one product');
  if (productIds.length > MAX_OFFERS_PER_RUN) throw new Error(`Create at most ${MAX_OFFERS_PER_RUN} offers at a time`);
  const account = await loadMarketplaceAccount(accountId);
  const pub = publisher(account);
  const { rows, setupProblems } = await loadRows(accountId, new Set(productIds));
  if (setupProblems.length) throw new Error(`Finish the account settings first: ${setupProblems.join(', ')}`);

  const result: PublishResult = { created: [], failed: [], notes: [] };
  for (const { row, match, details } of rows) {
    if (row.problems.length || !details || !match) {
      result.failed.push({ name: row.name, error: `not ready: ${row.problems.join(', ') || 'missing data'}` });
      continue;
    }
    const draft: OfferDraft = {
      sku: row.sku,
      ean: row.ean!,
      name: details.title,
      descriptionHtml: details.descriptionHtml,
      brand: details.vendor,
      imageUrls: details.imageUrls.slice(0, 16),
      weightGrams: details.weightGrams,
      quantity: row.stock,
      price: row.price!,
      currency: 'PLN',
    };
    try {
      const done = await pub.createOffer(draft, match);
      result.created.push(row.name);
      if (done.note) result.notes.push(`${row.name}: ${done.note}`);
    } catch (err) {
      result.failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.created.length) await importListings(accountId);
  return result;
}

const OPTIONS_TTL_MS = 6 * 3_600_000;

/** Allegro's shipping rates, return policies and warranties to choose from, read from Allegro and cached for a few hours. */
export async function loadAllegroOptions(accountId: string, force = false) {
  const account = await loadMarketplaceAccount(accountId);
  const cached = account.settings.allegroOptions;
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < OPTIONS_TTL_MS) return cached;
  const adapter = getMarketplaceAdapter(account);
  if (!(adapter instanceof AllegroAdapter)) throw new Error('This is not an Allegro account');
  const options = { fetchedAt: new Date().toISOString(), ...(await adapter.publishOptions()) };
  await getDb()
    .update(marketplaceAccounts)
    .set({ settings: { ...account.settings, allegroOptions: options } })
    .where(eq(marketplaceAccounts.id, accountId));
  return options;
}
