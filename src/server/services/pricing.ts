// The Pricing page: every platform's selling price per product, and sending a new price to the platform.
import { and, asc, eq, inArray, isNotNull } from 'drizzle-orm';
import { parsePrice, samePrice } from '../../lib/price';
import { isResearchMarketplace } from '../../lib/pricing-research';
import { minimumGrossPrice } from '../analytics/economics';
import { getDb } from '../db/client';
import { marketplaceAccounts, pricingRecommendations, productListings, products, type AnalyticsSettings } from '../db/schema';
import type { PriceUpdate } from '../integrations/types';
import { getMarketplaceAdapter } from './accounts';
import { currentCosts, loadAnalyticsSettings } from './costs';
import { needsMatching } from './inventory';
import { loadAccounting } from './invoicing';

/** Tab order on the page. */
export const PRICE_PLATFORMS = ['shopify', 'vonhalsky', 'empik', 'hebe', 'allegro'] as const;
export type PricePlatform = (typeof PRICE_PLATFORMS)[number];

export const PRICE_PLATFORM_LABEL: Record<PricePlatform, string> = { shopify: 'Shopify', vonhalsky: 'Von Halsky', empik: 'Empik', hebe: 'HEBE', allegro: 'Allegro' };

export function isPricePlatform(value: unknown): value is PricePlatform {
  return typeof value === 'string' && (PRICE_PLATFORMS as readonly string[]).includes(value);
}

/** Most prices one request changes; the page shows the same number of products. */
export const MAX_PRICES_PER_PUSH = 50;

export interface PricedListing {
  id: string;
  accountId: string;
  accountName: string;
  title: string;
  price: string | null;
  currency: string | null;
  active: boolean;
  listingStatus: string | null;
  priceUpdatedAt: Date | null;
  priceError: string | null;
  priceManual: boolean;
}

/**
 * The lowest gross price on this platform that still earns the minimum margin (Settings → Costs & margins), from the
 * product's current cost, the platform's commission and shipping, packaging and VAT. `no_cost` until the product has a cost.
 */
export interface PricingFloor {
  state: 'ok' | 'unreachable' | 'no_cost';
  /** PLN, gross; set when `state` is 'ok'. */
  price: number | null;
  /** The parts, for people who may see costs. */
  unitCost: number | null;
  commissionShare: number;
  shipping: number;
  packaging: number;
}

/** The floor for one product, or why there isn't one. Pure: everything it needs is passed in. */
export function priceFloor(
  platform: PricePlatform,
  unitCost: number | null,
  context: { settings: Required<AnalyticsSettings>; vatRate: number; margin: number },
): PricingFloor {
  const { settings, vatRate, margin } = context;
  if (unitCost === null || !Number.isFinite(unitCost)) {
    return { state: 'no_cost', price: null, unitCost: null, commissionShare: 0, shipping: 0, packaging: 0 };
  }
  const floor = minimumGrossPrice({ marketplace: platform, unitCost, vatRate, feeVatRate: vatRate, settings, margin });
  return { state: floor.price === null ? 'unreachable' : 'ok', price: floor.price, unitCost, commissionShare: floor.commissionShare, shipping: floor.shipping, packaging: floor.packaging };
}

/** Whether a price is below the floor (by more than a grosz of rounding). Prices in other currencies are not compared. */
export function belowFloor(price: string | number | null | undefined, currency: string | null | undefined, floor: PricingFloor | null): boolean {
  if (!floor || floor.price === null || price == null || price === '' || (currency && currency !== 'PLN')) return false;
  return Number(price) < floor.price - 0.005;
}

export interface PricingRow {
  product: typeof products.$inferSelect;
  /** What this platform sells it for; empty when the product isn't listed there. */
  listings: PricedListing[];
  /** The Shopify price, to compare with on the other platforms. */
  shopifyPrice: string | null;
  /** The lowest price that keeps the minimum margin on this platform. */
  floor: PricingFloor;
  recommendations: PricingRecommendation[];
}

export type PricingRecommendation = typeof pricingRecommendations.$inferSelect & { accountName: string };

export interface PricingView {
  /** The margin the floors keep, as a fraction of the gross price (0.1 = 10%). */
  minimumMargin: number;
  rows: PricingRow[];
  /** Offers on this platform not linked to a Shopify product yet, so they can't be priced here. */
  unlinked: number;
  /** Connected accounts of this platform. */
  accounts: { id: string; name: string }[];
}

export async function pricingView(platform: PricePlatform): Promise<PricingView> {
  const db = getDb();
  const [productRows, listingRows, accounts, pending, research, settings, accounting, costs] = await Promise.all([
    db.select().from(products).where(isNotNull(products.shopifyVariantId)).orderBy(asc(products.name)),
    db
      .select({
        id: productListings.id,
        productId: productListings.productId,
        accountId: productListings.accountId,
        accountName: marketplaceAccounts.name,
        marketplace: marketplaceAccounts.type,
        title: productListings.title,
        price: productListings.price,
        currency: productListings.currency,
        active: productListings.active,
        listingStatus: productListings.listingStatus,
        priceUpdatedAt: productListings.priceUpdatedAt,
        priceError: productListings.priceError,
        priceManual: productListings.priceManual,
      })
      .from(productListings)
      .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, productListings.accountId))
      .where(and(isNotNull(productListings.productId), inArray(marketplaceAccounts.type, platform === 'shopify' ? ['shopify'] : ['shopify', platform])))
      .orderBy(asc(productListings.title)),
    db.select({ id: marketplaceAccounts.id, name: marketplaceAccounts.name }).from(marketplaceAccounts).where(and(eq(marketplaceAccounts.type, platform), eq(marketplaceAccounts.enabled, true))),
    platform === 'shopify' ? Promise.resolve([]) : needsMatching(),
    isResearchMarketplace(platform) ? db.select({ recommendation: pricingRecommendations, accountName: marketplaceAccounts.name })
      .from(pricingRecommendations).innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, pricingRecommendations.accountId))
      .where(and(eq(marketplaceAccounts.type, platform), eq(marketplaceAccounts.enabled, true))) : Promise.resolve([]),
    loadAnalyticsSettings(),
    loadAccounting(),
    currentCosts(),
  ]);
  const floorContext = { settings, vatRate: accounting.settings.defaultVatRate ?? 0.23, margin: settings.minimumMargin };

  const shopifyPrice = new Map<string, string | null>();
  const here = new Map<string, PricedListing[]>();
  for (const { productId, marketplace, ...listing } of listingRows) {
    if (marketplace === 'shopify') shopifyPrice.set(productId!, listing.price);
    if (marketplace === platform) here.set(productId!, [...(here.get(productId!) ?? []), listing]);
  }
  return {
    minimumMargin: settings.minimumMargin,
    rows: productRows.map((product) => ({ product, listings: here.get(product.id) ?? [], shopifyPrice: shopifyPrice.get(product.id) ?? null,
      floor: priceFloor(platform, costs.has(product.id) ? Number(costs.get(product.id)!.unitCost) : null, floorContext),
      recommendations: research.filter((r) => r.recommendation.productId === product.id).map((r) => ({ ...r.recommendation, accountName: r.accountName })),
    })),
    unlinked: pending.filter((l) => l.marketplace === platform).length,
    accounts,
  };
}

export interface PushRequest {
  listingId: string;
  /** The new price as typed; "49,99" and "49.99" both work. */
  price: string;
}

export interface PushResult {
  updated: number;
  /** Asked for the price the listing already has. */
  unchanged: number;
  failed: { listingId: string; title: string; message: string }[];
}

/**
 * Sends new prices to their platforms. Unlike stock, prices are never held back by the stock "dry
 * run": pressing the button is the decision. Each account is one call, and an offer the platform
 * refuses fails alone, with the platform's reason kept on the listing.
 */
export async function pushPrices(requests: PushRequest[]): Promise<PushResult> {
  if (requests.length > MAX_PRICES_PER_PUSH) throw new Error(`Change at most ${MAX_PRICES_PER_PUSH} prices at a time`);
  const db = getDb();
  const result: PushResult = { updated: 0, unchanged: 0, failed: [] };
  if (requests.length === 0) return result;

  const rows = await db
    .select({
      id: productListings.id,
      title: productListings.title,
      externalId: productListings.externalId,
      sku: productListings.sku,
      ean: productListings.ean,
      ref: productListings.ref,
      price: productListings.price,
      currency: productListings.currency,
      productId: productListings.productId,
      account: marketplaceAccounts,
    })
    .from(productListings)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, productListings.accountId))
    .where(inArray(productListings.id, requests.map((r) => r.listingId)));
  const byId = new Map(rows.map((r) => [r.id, r]));

  const perAccount = new Map<string, { account: (typeof rows)[number]['account']; items: { listing: (typeof rows)[number]; update: PriceUpdate }[] }>();
  for (const request of requests) {
    const listing = byId.get(request.listingId);
    if (!listing) {
      result.failed.push({ listingId: request.listingId, title: 'Listing', message: 'This listing no longer exists. Refresh the page.' });
      continue;
    }
    const fail = (message: string) => result.failed.push({ listingId: listing.id, title: listing.title, message });
    const price = parsePrice(request.price);
    if (!price) fail(`“${request.price}” is not a price. Use a number above zero, like 49.99`);
    else if (!listing.account.enabled) fail(`${listing.account.name} is switched off in Settings → Integrations`);
    else if (!listing.productId) fail('Link this offer to a Shopify product in Inventory first');
    else if (samePrice(listing.price, price)) result.unchanged++;
    else {
      const group = perAccount.get(listing.account.id) ?? { account: listing.account, items: [] };
      group.items.push({
        listing,
        update: { externalId: listing.externalId, sku: listing.sku, ean: listing.ean || null, ref: listing.ref, price, currency: listing.currency ?? 'PLN' },
      });
      perAccount.set(listing.account.id, group);
    }
  }

  for (const { account, items } of perAccount.values()) {
    let refused = new Map<string, string>();
    let wholeFailure: string | null = null;
    try {
      const failures = await getMarketplaceAdapter(account).setPrices(items.map((i) => i.update));
      refused = new Map(failures.map((f) => [f.externalId, f.message]));
    } catch (err) {
      wholeFailure = err instanceof Error ? err.message : String(err);
    }
    const now = new Date();
    for (const { listing, update } of items) {
      const message = wholeFailure ?? refused.get(listing.externalId);
      if (message) {
        await db.update(productListings).set({ priceError: message }).where(eq(productListings.id, listing.id));
        result.failed.push({ listingId: listing.id, title: listing.title, message });
      } else {
        await db
          .update(productListings)
          .set({ price: update.price, currency: update.currency, priceUpdatedAt: now, priceError: null, priceManual: true })
          .where(eq(productListings.id, listing.id));
        result.updated++;
      }
    }
  }
  return result;
}
