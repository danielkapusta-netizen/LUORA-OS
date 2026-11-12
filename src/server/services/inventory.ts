import { and, asc, eq, inArray, isNotNull, isNull, lt, ne, or, sql } from 'drizzle-orm';
import { chunk, getDb, insertMany, insertStatements, type Tx } from '../db/client';
import {
  marketplaceAccounts,
  orderItems,
  orders,
  productListings,
  products,
  stockMovements,
  stockSyncLog,
} from '../db/schema';
import { cleanShopifyTitle, hasRealSku, normalizeEan, placeholderSku } from '../../lib/sku';
import { desiredQuantity, GONE, marketplaceQuantity, type StockTarget } from '../../lib/stock';
import type { Listing, StockFailure, StockUpdate } from '../integrations/types';
import { enqueue, JOBS } from '../jobs/queue';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { logEvent } from './events';
import { createMatcher, isClearSuggestion, type MatchSuggestion } from './matching';
import { msg } from '@/lib/i18n/msg';

export { desiredQuantity, GONE, marketplaceQuantity, type StockTarget } from '../../lib/stock';

/** Seconds to wait so a burst of orders becomes one stock push per account. */
const PUSH_DEBOUNCE_SECONDS = 30;


/** Takes stock for every matched line of an order. Returns true if any stock changed. */
export async function applyOrderStock(db: Tx, orderId: string): Promise<boolean> {
  // Claim the order first (compare-and-set) so stock is never taken twice.
  const claimed = await db
    .update(orders)
    .set({ stockApplied: true })
    .where(and(eq(orders.id, orderId), eq(orders.stockApplied, false)))
    .returning({ id: orders.id });
  if (claimed.length === 0) return false;
  const lines = await db
    .select({ productId: orderItems.productId, quantity: sql<number>`sum(${orderItems.quantity})` })
    .from(orderItems)
    .where(and(eq(orderItems.orderId, orderId), isNotNull(orderItems.productId)))
    .groupBy(orderItems.productId);
  if (lines.length === 0) return false;
  await db.batch([
    ...lines.map((l) => db.update(products).set({ stock: sql`${products.stock} - ${l.quantity}` }).where(eq(products.id, l.productId!))),
    ...insertStatements(db, stockMovements, lines.map((l) => ({ productId: l.productId!, delta: -l.quantity, reason: 'order', orderId }))),
  ] as unknown as Parameters<Tx['batch']>[0]);
  await logEvent(db, orderId, 'stock', `Stock taken for ${lines.length} product(s)`);
  return true;
}

/** Returns the stock an order took (on cancellation). Returns true if any stock changed. */
export async function restockOrder(db: Tx, orderId: string): Promise<boolean> {
  const claimed = await db
    .update(orders)
    .set({ stockApplied: false })
    .where(and(eq(orders.id, orderId), eq(orders.stockApplied, true)))
    .returning({ id: orders.id });
  if (claimed.length === 0) return false;
  const taken = (
    await db
      .select({ productId: stockMovements.productId, delta: sql<number>`sum(${stockMovements.delta})` })
      .from(stockMovements)
      .where(eq(stockMovements.orderId, orderId))
      .groupBy(stockMovements.productId)
  ).filter((r) => r.delta !== 0);
  if (taken.length === 0) return false;
  await db.batch([
    ...taken.map((r) => db.update(products).set({ stock: sql`${products.stock} - ${r.delta}` }).where(eq(products.id, r.productId))),
    ...insertStatements(db, stockMovements, taken.map((r) => ({ productId: r.productId, delta: -r.delta, reason: 'cancel', orderId }))),
  ] as unknown as Parameters<Tx['batch']>[0]);
  await logEvent(db, orderId, 'stock', 'Stock returned');
  return true;
}

export async function adjustStock(input: {
  productId: string;
  mode: 'set' | 'add';
  value: number;
  userId: string;
  note?: string;
}): Promise<void> {
  const db = getDb();
  const [product] = await db.select().from(products).where(eq(products.id, input.productId));
  if (!product) throw new Error(msg('Product not found'));
  const delta = input.mode === 'set' ? input.value - product.stock : input.value;
  if (delta === 0) return;
  // Relative update, so an order arriving meanwhile isn't overwritten.
  await db.batch([
    db.update(products).set({ stock: sql`${products.stock} + ${delta}` }).where(eq(products.id, product.id)),
    db.insert(stockMovements).values({ productId: product.id, delta, reason: 'manual', userId: input.userId, note: input.note || null }),
  ]);
  await scheduleStockPush();
}

/** Queues a (debounced) stock push for every account with stock sync switched on. */
export async function scheduleStockPush(): Promise<void> {
  const accounts = await getDb()
    .select({ id: marketplaceAccounts.id })
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.enabled, true), eq(marketplaceAccounts.stockSyncEnabled, true)));
  for (const account of accounts) {
    await enqueue(JOBS.stockPush, { accountId: account.id }, { debounceSeconds: PUSH_DEBOUNCE_SECONDS, singletonKey: account.id });
  }
}

/**
 * Reads every listing from the marketplace.
 * - Shopify is the product list: each variant is a product (name, SKU, barcode and photo follow
 *   Shopify). A variant new to Luora starts with its Shopify quantity; known products keep their stock.
 * - Allegro / Empik listings never create products. They are linked to a Shopify product with the
 *   same SKU or barcode, or wait on the Inventory page to be matched by name.
 */
export async function importListings(accountId: string): Promise<{ listings: number; created: number; unmatched: number; gone: number }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const adapter = getMarketplaceAdapter(account);
  const isShopify = account.type === 'shopify';
  const startedAt = new Date();
  let count = 0;
  let created = 0;

  for await (const listing of adapter.listListings()) {
    count++;
    const active = listing.active !== false;
    const soldOut = !active && listing.soldOut === true;
    // What the marketplace can sell: an ended or inactive offer keeps an old stock figure that means nothing.
    const quantity = active ? listing.quantity : 0;
    let productId: string | null = null;
    if (isShopify) {
      const result = await upsertShopifyProduct(listing);
      productId = result.productId;
      if (result.created) created++;
    }
    await db
      .insert(productListings)
      .values({
        accountId,
        externalId: listing.externalId,
        sku: listing.sku,
        title: isShopify ? cleanShopifyTitle(listing.title) : listing.title,
        ean: normalizeEan(listing.ean),
        ref: listing.ref,
        productId,
        lastSeenQty: quantity,
        lastSeenAt: new Date(),
        active,
        listingStatus: listing.status ?? null,
        soldOut,
        stockLocked: listing.stockLocked ?? null,
        price: listing.price ?? null,
        currency: listing.currency ?? null,
      })
      .onConflictDoUpdate({
        target: [productListings.accountId, productListings.externalId],
        set: {
          sku: listing.sku,
          title: isShopify ? cleanShopifyTitle(listing.title) : listing.title,
          // Allegro's list has no barcode; keep the one read from the offer earlier.
          ean: sql`coalesce(${normalizeEan(listing.ean)}, ${productListings.ean})`,
          ref: listing.ref,
          lastSeenQty: quantity,
          lastSeenAt: new Date(),
          active,
          listingStatus: listing.status ?? null,
          soldOut,
          stockLocked: listing.stockLocked ?? null,
          // A marketplace that doesn't report prices in its list keeps the one we know.
          price: sql`coalesce(${listing.price ?? null}, ${productListings.price})`,
          currency: sql`coalesce(${listing.currency ?? null}, ${productListings.currency})`,
          // Shopify listings always belong to their own product; other links are kept as made.
          productId: isShopify ? productId : sql`${productListings.productId}`,
        },
      });
  }

  // The whole list was read (an error above would have thrown), so an offer that was not in it no longer exists there:
  // a variant deleted in Shopify, an offer removed on Allegro. Nothing is sent to it any more. A marketplace that
  // answers with nothing at all is not believed.
  let gone = 0;
  if (count > 0) {
    const vanished = await db
      .update(productListings)
      .set({ active: false, soldOut: false, listingStatus: GONE, lastSeenQty: 0 })
      .where(
        and(
          eq(productListings.accountId, accountId),
          or(isNull(productListings.lastSeenAt), lt(productListings.lastSeenAt, startedAt)),
          or(isNull(productListings.listingStatus), ne(productListings.listingStatus, GONE)),
        ),
      )
      .returning({ id: productListings.id });
    gone = vanished.length;
  }

  if (adapter.listingEans) await readMissingEans(accountId, adapter.listingEans.bind(adapter));
  await autoLinkListings();
  // Link order lines that arrived before their product (or listing link) existed.
  await db.run(sql`
    update order_items set product_id = (
      select l.product_id from product_listings l join orders o on o.account_id = l.account_id
      where o.id = order_items.order_id and l.external_id = order_items.external_product_id)
    where product_id is null and external_product_id is not null and exists (
      select 1 from product_listings l join orders o on o.account_id = l.account_id
      where o.id = order_items.order_id and l.external_id = order_items.external_product_id and l.product_id is not null)`);
  await db.run(sql`
    update order_items set product_id = (select p.id from products p where p.sku = order_items.sku)
    where product_id is null and sku is not null and exists (select 1 from products p where p.sku = order_items.sku)`);
  // Fill in photos for order lines whose own marketplace (e.g. Allegro, Empik) has none.
  await db.run(sql`
    update order_items set image_url = (select p.image_url from products p where p.id = order_items.product_id)
    where image_url is null and product_id is not null
      and exists (select 1 from products p where p.id = order_items.product_id and p.image_url is not null)`);
  const [{ unmatched }] = await db
    .select({ unmatched: sql<number>`count(*)` })
    .from(productListings)
    .leftJoin(products, eq(products.id, productListings.productId))
    .where(and(eq(productListings.accountId, accountId), isNull(products.shopifyVariantId), or(isNull(productListings.listingStatus), ne(productListings.listingStatus, GONE))));
  return { listings: count, created, unmatched, gone };
}

async function upsertShopifyProduct(listing: Listing): Promise<{ productId: string; created: boolean }> {
  const db = getDb();
  const name = cleanShopifyTitle(listing.title);
  const [byVariant] = await db.select().from(products).where(eq(products.shopifyVariantId, listing.externalId));
  const [bySku] = byVariant || !listing.sku ? [] : await db.select().from(products).where(eq(products.sku, listing.sku));
  const existing = byVariant ?? bySku;
  if (existing) {
    const sku = listing.sku && listing.sku !== existing.sku ? listing.sku : existing.sku;
    const update = {
      name,
      shopifyVariantId: listing.externalId,
      ean: normalizeEan(listing.ean) ?? existing.ean,
      imageUrl: listing.imageUrl ?? existing.imageUrl,
      brand: listing.brand ?? existing.brand,
      category: listing.category ?? existing.category,
    };
    try {
      await db.update(products).set({ ...update, sku }).where(eq(products.id, existing.id));
    } catch {
      // The new SKU belongs to another product already; keep the old one rather than fail the import.
      await db.update(products).set(update).where(eq(products.id, existing.id));
    }
    return { productId: existing.id, created: false };
  }
  const stock = Math.max(0, listing.quantity ?? 0);
  const [inserted] = await db
    .insert(products)
    .values({
      sku: listing.sku || placeholderSku(listing.externalId),
      name,
      stock,
      imageUrl: listing.imageUrl ?? null,
      ean: normalizeEan(listing.ean),
      shopifyVariantId: listing.externalId,
      brand: listing.brand ?? null,
      category: listing.category ?? null,
    })
    .returning({ id: products.id });
  await db.insert(stockMovements).values({ productId: inserted.id, delta: stock, reason: 'import' });
  return { productId: inserted.id, created: true };
}

/** Offers asked per import; the rest follow on the next import. */
const EAN_LOOKUPS_PER_IMPORT = 100;

/**
 * Fills in barcodes the listing call doesn't return (Allegro). An offer without one is stored as
 * '' so it isn't asked again.
 */
async function readMissingEans(accountId: string, lookup: (ids: string[]) => Promise<Map<string, string | null>>): Promise<void> {
  const db = getDb();
  const missing = await db
    .select({ id: productListings.id, externalId: productListings.externalId })
    .from(productListings)
    .where(and(eq(productListings.accountId, accountId), isNull(productListings.ean)))
    .limit(EAN_LOOKUPS_PER_IMPORT);
  if (missing.length === 0) return;
  let found: Map<string, string | null>;
  try {
    found = await lookup(missing.map((l) => l.externalId));
  } catch (err) {
    console.error(`[import] reading barcodes for ${accountId}:`, err);
    return;
  }
  for (const l of missing) {
    if (!found.has(l.externalId)) continue;
    await db.update(productListings).set({ ean: normalizeEan(found.get(l.externalId)) ?? '' }).where(eq(productListings.id, l.id));
  }
}

/** Links Allegro / Empik listings that aren't on a Shopify product yet to the one with the same SKU or barcode. */
async function autoLinkListings(): Promise<void> {
  const db = getDb();
  const shopifyProducts = await db
    .select({ id: products.id, sku: products.sku, ean: products.ean })
    .from(products)
    .where(isNotNull(products.shopifyVariantId));
  const bySku = new Map(shopifyProducts.filter((p) => hasRealSku(p.sku)).map((p) => [p.sku, p.id]));
  const byEan = new Map(shopifyProducts.filter((p) => p.ean).map((p) => [p.ean!, p.id]));
  for (const l of await needsMatching()) {
    const productId = (l.sku && bySku.get(l.sku)) || (l.ean && byEan.get(l.ean)) || null;
    if (productId) await linkListing(l.id, productId);
  }
}

/**
 * Points a listing at a product (or unlinks it with null). When the listing leaves an older
 * product that came from Allegro / Empik and nothing else uses it, that product is folded into
 * the new one: its order lines and stock history move over, and it is deleted. The Shopify
 * product keeps its own stock.
 */
export async function linkListing(listingId: string, productId: string | null): Promise<void> {
  const db = getDb();
  const [listing] = await db.select().from(productListings).where(eq(productListings.id, listingId));
  if (!listing) throw new Error(msg('Listing not found'));
  await db.update(productListings).set({ productId }).where(eq(productListings.id, listingId));
  if (productId) {
    // A Shopify product without a barcode takes the one from the offer it was just matched to,
    // so other offers with that EAN (Allegro) match it too.
    if (listing.ean) {
      const filled = await db
        .update(products)
        .set({ ean: listing.ean })
        .where(and(eq(products.id, productId), isNull(products.ean)))
        .returning({ id: products.id });
      if (filled.length) {
        const sameEan = (await needsMatching()).filter((l) => l.ean === listing.ean && l.id !== listingId);
        for (const l of sameEan) await linkListing(l.id, productId);
      }
    }
    // Order lines bought from this offer now count against the product.
    await db.run(sql`
      update order_items set product_id = ${productId}
      where external_product_id = ${listing.externalId}
        and order_id in (select id from orders where account_id = ${listing.accountId})
        and (product_id is null or product_id = ${listing.productId})`);
    const old = listing.productId;
    if (old && old !== productId) {
      const [legacy] = await db.select({ shopifyVariantId: products.shopifyVariantId }).from(products).where(eq(products.id, old));
      const [{ others }] = await db.select({ others: sql<number>`count(*)` }).from(productListings).where(eq(productListings.productId, old));
      if (legacy && !legacy.shopifyVariantId && others === 0) {
        await db.batch([
          db.update(orderItems).set({ productId }).where(eq(orderItems.productId, old)),
          db.update(stockMovements).set({ productId }).where(eq(stockMovements.productId, old)),
          db.delete(products).where(eq(products.id, old)),
        ]);
      }
    }
  }
  await scheduleStockPush();
}

/** Allegro / Empik listings that are not linked to a Shopify product. */
export async function needsMatching() {
  return getDb()
    .select({
      id: productListings.id,
      accountId: productListings.accountId,
      accountName: marketplaceAccounts.name,
      marketplace: marketplaceAccounts.type,
      externalId: productListings.externalId,
      sku: productListings.sku,
      ean: productListings.ean,
      title: productListings.title,
      lastSeenQty: productListings.lastSeenQty,
      lastSeenAt: productListings.lastSeenAt,
      lastPushedQty: productListings.lastPushedQty,
      lastPushedAt: productListings.lastPushedAt,
    })
    .from(productListings)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, productListings.accountId))
    .leftJoin(products, eq(products.id, productListings.productId))
    .where(
      and(
        ne(marketplaceAccounts.type, 'shopify'),
        isNull(products.shopifyVariantId),
        // An offer that no longer exists on the marketplace has nothing to be matched for.
        or(isNull(productListings.listingStatus), ne(productListings.listingStatus, GONE)),
      ),
    )
    .orderBy(asc(marketplaceAccounts.name), asc(productListings.title));
}

export type PendingListing = Awaited<ReturnType<typeof needsMatching>>[number];

export interface MatchGroup {
  /** The shared barcode, or the listing id for an offer without one. */
  key: string;
  ean: string | null;
  listings: PendingListing[];
  /** Up to three Shopify products, scored on the best of the group's titles. */
  suggestions: MatchSuggestion[];
  clear: boolean;
  /** The top suggestion already has another barcode, so linking would not carry over to the rest by EAN. */
  eanDiffers: boolean;
}

/**
 * Listings waiting to be matched. Offers on Allegro and Empik that share a barcode are one
 * product, so they form one group; each group gets Shopify suggestions by name.
 */
export async function matchingGroups(): Promise<MatchGroup[]> {
  const [pending, catalogue] = await Promise.all([
    needsMatching(),
    getDb().select({ id: products.id, name: products.name, ean: products.ean }).from(products).where(isNotNull(products.shopifyVariantId)),
  ]);
  const suggest = createMatcher(catalogue);
  const eanOfProduct = new Map(catalogue.map((p) => [p.id, p.ean]));
  const groups = new Map<string, PendingListing[]>();
  for (const l of pending) {
    const key = l.ean ? `ean:${l.ean}` : `listing:${l.id}`;
    groups.set(key, [...(groups.get(key) ?? []), l]);
  }
  return [...groups].map(([key, listings]) => {
    const best = new Map<string, number>();
    for (const l of listings) for (const sg of suggest(l.title)) best.set(sg.productId, Math.max(best.get(sg.productId) ?? 0, sg.score));
    const suggestions = [...best].map(([productId, score]) => ({ productId, score })).sort((a, b) => b.score - a.score).slice(0, 3);
    const ean = listings[0].ean || null;
    const topEan = suggestions[0] ? eanOfProduct.get(suggestions[0].productId) : null;
    return { key, ean, listings, suggestions, clear: isClearSuggestion(suggestions), eanDiffers: Boolean(ean && topEan && topEan !== ean) };
  });
}

/** Links all offers of a group (same barcode) to one Shopify product. */
export async function linkGroup(listingIds: string[], productId: string): Promise<void> {
  for (const id of listingIds) await linkListing(id, productId);
}

/** Links every group whose best suggestion is clear. Returns how many offers were linked. */
export async function confirmClearSuggestions(): Promise<number> {
  let linked = 0;
  for (const g of await matchingGroups()) {
    if (!g.clear || g.eanDiffers) continue;
    await linkGroup(g.listings.map((l) => l.id), g.suggestions[0].productId);
    linked += g.listings.length;
  }
  return linked;
}

/** Listings whose marketplace quantity differs from what they should show. */
export function pendingUpdatesFor(
  rows: (StockTarget & {
    listingId: string;
    externalId: string;
    sku: string | null;
    ref: Record<string, string | number | null>;
    lastPushedQty: number | null;
  })[],
): (StockUpdate & { listingId: string })[] {
  const out: (StockUpdate & { listingId: string })[] = [];
  for (const r of rows) {
    const quantity = desiredQuantity(r);
    if (quantity === null || r.lastPushedQty === quantity) continue;
    // A sold-out offer already stands at zero; sending it zero again only invites a refusal.
    if (r.active === false && r.soldOut && quantity === 0) continue;
    out.push({ listingId: r.listingId, externalId: r.externalId, sku: r.sku, ref: r.ref, quantity });
  }
  return out;
}

/**
 * Sends master stock to one marketplace account (or only logs it in dry-run mode). Normally only
 * listings whose last push differs; with force, every listing whose marketplace quantity differs.
 */
export async function runStockPush(accountId: string, opts: { force?: boolean } = {}): Promise<{ pushed: number; refused: number; dryRun: boolean }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  if (!account.stockSyncEnabled || !account.enabled) return { pushed: 0, refused: 0, dryRun: account.stockDryRun };

  const rows = await db
    .select({
      listingId: productListings.id,
      externalId: productListings.externalId,
      sku: productListings.sku,
      ref: productListings.ref,
      stock: products.stock,
      lastPushedQty: productListings.lastPushedQty,
      lastPushedAt: productListings.lastPushedAt,
      lastSeenQty: productListings.lastSeenQty,
      lastSeenAt: productListings.lastSeenAt,
      active: productListings.active,
      soldOut: productListings.soldOut,
      stockLocked: productListings.stockLocked,
      stockMode: productListings.stockMode,
      fixedQty: productListings.fixedQty,
    })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    // Every listing linked to a product follows the app's stock, Shopify product or not; unlinked ones wait under "Needs matching".
    .where(eq(productListings.accountId, accountId))
    .orderBy(asc(productListings.id));
  const updates = opts.force
    ? pendingUpdatesFor(rows.map((r) => ({ ...r, lastPushedQty: marketplaceQuantity(r) })))
    : pendingUpdatesFor(rows);
  if (updates.length === 0) return { pushed: 0, refused: 0, dryRun: account.stockDryRun };

  if (account.stockDryRun) {
    // Nothing is sent, so the same difference would be logged on every push; only log changes.
    // Only the listings being pushed, newest first, so the first row seen per listing is its last log.
    const previous = new Map<string, number>();
    for (const ids of chunk(updates.map((u) => u.listingId))) {
      const rows = await db.all<{ listing_id: string; quantity: number }>(sql`
        select listing_id, quantity from stock_sync_log
        where listing_id in (${sql.join(ids.map((id) => sql`${id}`), sql`, `)}) and dry_run = 1
        order by created_at desc`);
      for (const r of rows) if (!previous.has(r.listing_id)) previous.set(r.listing_id, r.quantity);
    }
    const fresh = updates.filter((u) => previous.get(u.listingId) !== u.quantity);
    if (fresh.length) {
      await insertMany(db, stockSyncLog, fresh.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: true, ok: true })));
    }
    return { pushed: fresh.length, refused: 0, dryRun: true };
  }

  let failures: StockFailure[];
  try {
    failures = await getMarketplaceAdapter(account).setStock(updates);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db
      .update(productListings)
      .set({ lastPushError: message })
      .where(inArray(productListings.id, updates.map((u) => u.listingId)));
    await insertMany(
      db,
      stockSyncLog,
      updates.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: false, ok: false, error: message })),
    );
    throw err;
  }

  // One refused offer doesn't stop the others: it keeps its error and is retried on the next change,
  // except an offer that no longer exists on the marketplace, which stops being sent to (the next
  // listings import turns it back on if it reappears).
  const failed = new Map(failures.map((f) => [f.externalId, f]));
  const wasSoldOut = new Set(rows.filter((r) => !r.active && r.soldOut).map((r) => r.listingId));
  const now = new Date();
  for (const u of updates) {
    const f = failed.get(u.externalId);
    await db
      .update(productListings)
      .set(
        f
          ? { lastPushError: f.message, ...(f.gone ? { active: false, soldOut: false, listingStatus: GONE } : {}) }
          : {
              lastPushedQty: u.quantity,
              lastPushedAt: now,
              lastPushError: null,
              // A sold-out offer that was sent units is on sale again; the next read confirms it, or says otherwise.
              ...(wasSoldOut.has(u.listingId) && u.quantity > 0 ? { active: true, soldOut: false } : {}),
            },
      )
      .where(eq(productListings.id, u.listingId));
  }
  await insertMany(
    db,
    stockSyncLog,
    updates.map((u) => {
      const f = failed.get(u.externalId);
      return { accountId, listingId: u.listingId, quantity: u.quantity, dryRun: false, ok: !f, error: f?.message ?? null };
    }),
  );
  return { pushed: updates.length - failed.size, refused: failed.size, dryRun: false };
}

/** Does master stock cover every matched line of the order? Unmatched lines count as covered. */
export async function stockCoversOrder(db: Tx, orderId: string): Promise<boolean> {
  const rows = await db
    .select({ stock: products.stock })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(eq(orderItems.orderId, orderId));
  // Stock was already taken when the order was imported, so it only has to stay non-negative.
  return rows.every((r) => r.stock >= 0);
}

/** Shopify products (the product list) with every listing linked to them. */
export async function listProductsWithListings() {
  const db = getDb();
  const productRows = await db.select().from(products).where(isNotNull(products.shopifyVariantId)).orderBy(asc(products.name));
  const listingRows = await db
    .select({
      id: productListings.id,
      productId: productListings.productId,
      accountId: productListings.accountId,
      accountName: marketplaceAccounts.name,
      marketplace: marketplaceAccounts.type,
      externalId: productListings.externalId,
      sku: productListings.sku,
      title: productListings.title,
      lastSeenQty: productListings.lastSeenQty,
      lastSeenAt: productListings.lastSeenAt,
      lastPushedQty: productListings.lastPushedQty,
      lastPushedAt: productListings.lastPushedAt,
      lastPushError: productListings.lastPushError,
      active: productListings.active,
      listingStatus: productListings.listingStatus,
      soldOut: productListings.soldOut,
      stockLocked: productListings.stockLocked,
      ref: productListings.ref,
      stockMode: productListings.stockMode,
      fixedQty: productListings.fixedQty,
    })
    .from(productListings)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, productListings.accountId))
    .where(isNotNull(productListings.productId))
    .orderBy(asc(marketplaceAccounts.type), asc(productListings.title));
  return { products: productRows, listings: listingRows };
}

export async function recentStockLog(limit = 50) {
  return getDb()
    .select({
      id: stockSyncLog.id,
      accountName: marketplaceAccounts.name,
      title: productListings.title,
      quantity: stockSyncLog.quantity,
      dryRun: stockSyncLog.dryRun,
      ok: stockSyncLog.ok,
      error: stockSyncLog.error,
      createdAt: stockSyncLog.createdAt,
    })
    .from(stockSyncLog)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, stockSyncLog.accountId))
    .leftJoin(productListings, eq(productListings.id, stockSyncLog.listingId))
    .orderBy(sql`${stockSyncLog.createdAt} desc`)
    .limit(limit);
}

/** Chooses what is sent to one listing: the master stock, a fixed quantity, or nothing. */
export async function setListingStock(listingId: string, mode: 'master' | 'fixed' | 'off', fixedQty?: number | null): Promise<void> {
  if (mode === 'fixed' && (fixedQty == null || !Number.isInteger(fixedQty) || fixedQty < 0)) throw new Error(msg('Enter a whole number, 0 or more'));
  const db = getDb();
  const [listing] = await db.select({ id: productListings.id }).from(productListings).where(eq(productListings.id, listingId));
  if (!listing) throw new Error(msg('Listing not found'));
  await db
    .update(productListings)
    .set({ stockMode: mode, fixedQty: mode === 'fixed' ? fixedQty! : null, lastPushError: null })
    .where(eq(productListings.id, listingId));
  await scheduleStockPush();
}

/** How many listings would be sent a different quantity on the next push, per account. */
export async function pendingPushCounts(): Promise<Map<string, number>> {
  const rows = await getDb()
    .select({
      accountId: productListings.accountId,
      listingId: productListings.id,
      externalId: productListings.externalId,
      sku: productListings.sku,
      ref: productListings.ref,
      stock: products.stock,
      lastPushedQty: productListings.lastPushedQty,
      lastSeenQty: productListings.lastSeenQty,
      lastSeenAt: productListings.lastSeenAt,
      lastPushedAt: productListings.lastPushedAt,
      active: productListings.active,
      soldOut: productListings.soldOut,
      stockLocked: productListings.stockLocked,
      stockMode: productListings.stockMode,
      fixedQty: productListings.fixedQty,
    })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId));
  const counts = new Map<string, number>();
  for (const r of rows) {
    const current = marketplaceQuantity(r);
    if (pendingUpdatesFor([{ ...r, lastPushedQty: current }]).length) counts.set(r.accountId, (counts.get(r.accountId) ?? 0) + 1);
  }
  return counts;
}

export interface StockSyncStatus {
  /** When stock last reached this marketplace. */
  lastSuccessAt: Date | null;
  /** Active listings whose last update was refused, and the first reason. */
  failing: number;
  firstError: string | null;
}

/** Per marketplace account: did stock last get through, and which listings are being refused. */
export async function stockSyncStatus(): Promise<Map<string, StockSyncStatus>> {
  const db = getDb();
  const accountIds = (await db.select({ id: marketplaceAccounts.id }).from(marketplaceAccounts)).map((a) => a.id);
  const [pushed, errors] = await Promise.all([
    // One indexed lookup per account; a scan over the whole log on every page view overloaded the database.
    Promise.all(
      accountIds.map(async (id) => {
        const [row] = await db.all<{ at: number | null }>(sql`
          select max(created_at) as at from stock_sync_log where account_id = ${id} and ok = 1 and dry_run = 0`);
        return { account_id: id, at: row?.at ?? null };
      }),
    ),
    db.all<{ account_id: string; n: number; error: string | null }>(sql`
      select account_id, count(*) as n, min(last_push_error) as error from product_listings
      where last_push_error is not null and active = 1 group by account_id`),
  ]);
  const out = new Map<string, StockSyncStatus>();
  const get = (id: string) => out.get(id) ?? out.set(id, { lastSuccessAt: null, failing: 0, firstError: null }).get(id)!;
  for (const r of pushed) get(r.account_id).lastSuccessAt = r.at == null ? null : new Date(r.at);
  for (const r of errors) Object.assign(get(r.account_id), { failing: r.n, firstError: r.error });
  return out;
}

/**
 * Takes a marketplace's numbers as the master stock: for the chosen products, or for every product where the two
 * differ. Used once to start from Shopify's stock, and per product whenever the marketplace turns out to be right.
 * The listings must have been read just before. Returns how many products changed.
 */
export async function adoptMarketplaceStock(input: { accountId: string; productIds?: string[]; userId: string | null }): Promise<number> {
  const db = getDb();
  const account = await loadMarketplaceAccount(input.accountId);
  const rows = await db
    .select({ productId: products.id, stock: products.stock, seen: productListings.lastSeenQty, ref: productListings.ref })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    .where(and(eq(productListings.accountId, input.accountId), eq(productListings.active, true), isNotNull(productListings.lastSeenQty)))
    .orderBy(asc(productListings.id));
  const wanted = input.productIds ? new Set(input.productIds) : null;
  const done = new Set<string>();
  const changes: { productId: string; delta: number }[] = [];
  for (const r of rows) {
    if (done.has(r.productId) || (wanted && !wanted.has(r.productId))) continue;
    done.add(r.productId);
    // Shopify keeps no count for a product it does not track, so there is no number to take.
    if (r.ref.tracked === 0) continue;
    if (r.seen !== null && r.seen !== r.stock) changes.push({ productId: r.productId, delta: r.seen - r.stock });
  }
  for (const part of chunk(changes, 25)) {
    // Relative, so an order arriving meanwhile isn't overwritten.
    await db.batch([
      ...part.map((c) => db.update(products).set({ stock: sql`${products.stock} + ${c.delta}` }).where(eq(products.id, c.productId))),
      ...insertStatements(db, stockMovements, part.map((c) => ({ productId: c.productId, delta: c.delta, reason: 'marketplace', userId: input.userId, note: `Taken from ${account.name}` }))),
    ] as unknown as Parameters<Tx['batch']>[0]);
  }
  if (changes.length) await scheduleStockPush();
  return changes.length;
}

export interface ActivationResult {
  accountName: string;
  quantity: number;
  /** Whether the marketplace shows the offer on sale when read back straight away. */
  onSale: boolean;
  /** The marketplace's own status when it is still off sale. */
  status: string | null;
}

/**
 * Puts an off-sale offer back on sale with the stock it should show. Allegro has a call for that; elsewhere the
 * quantity is sent and the marketplace decides. The offer is then read back, because only the marketplace knows.
 */
export async function activateListing(listingId: string): Promise<ActivationResult> {
  const db = getDb();
  const [row] = await db
    .select({ listing: productListings, stock: products.stock })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    .where(eq(productListings.id, listingId));
  if (!row) throw new Error(msg('Listing not found'));
  const { listing } = row;
  const account = await loadMarketplaceAccount(listing.accountId);
  if (!account.enabled || !account.stockSyncEnabled) throw new Error(msg('Stock sync is switched off for this account (Settings → Integrations)'));
  if (account.stockDryRun) throw new Error(msg('This account is in dry run, so nothing is sent to it. Switch dry run off in Settings → Integrations first.'));
  if (listing.stockLocked) throw new Error(msg('The marketplace counts this quantity itself'));
  if (listing.stockMode === 'off') throw new Error(msg('This listing is set to “Nothing (manage there)”'));
  // What it would show if it were on sale.
  const quantity = desiredQuantity({ stock: row.stock, stockMode: listing.stockMode, fixedQty: listing.fixedQty }) ?? 0;
  if (quantity <= 0) throw new Error(msg('There is no stock to put on sale'));

  const adapter = getMarketplaceAdapter(account);
  const update: StockUpdate = { externalId: listing.externalId, sku: listing.sku, ref: listing.ref, quantity };
  const log = (ok: boolean, error: string | null) => db.insert(stockSyncLog).values({ accountId: account.id, listingId, quantity, dryRun: false, ok, error });
  try {
    if (adapter.activate) await adapter.activate(update);
    else {
      const [refused] = await adapter.setStock([update]);
      if (refused) throw new Error(refused.message);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(productListings).set({ lastPushError: message }).where(eq(productListings.id, listingId));
    await log(false, message);
    throw err;
  }
  await db.update(productListings).set({ lastPushedQty: quantity, lastPushedAt: new Date(), lastPushError: null }).where(eq(productListings.id, listingId));
  await log(true, null);

  try {
    await importListings(account.id);
  } catch (err) {
    console.error(`[activate] reading ${account.name} back:`, err);
  }
  const [after] = await db.select().from(productListings).where(eq(productListings.id, listingId));
  return { accountName: account.name, quantity, onSale: Boolean(after?.active), status: after?.listingStatus ?? null };
}

const STOCK_LOG_KEEP_DAYS = 30;

/** Drops log lines older than a month, a slice at a time so a big backlog can't overload the database. */
export async function pruneStockLog(now = new Date()): Promise<number> {
  const db = getDb();
  const cutoff = now.getTime() - STOCK_LOG_KEEP_DAYS * 86_400_000;
  let removed = 0;
  for (let round = 0; round < 25; round++) {
    const rows = await db.all<{ id: string }>(sql`select id from stock_sync_log where created_at < ${cutoff} limit 2000`);
    if (rows.length === 0) break;
    for (const ids of chunk(rows.map((r) => r.id))) await db.delete(stockSyncLog).where(inArray(stockSyncLog.id, ids));
    removed += rows.length;
  }
  return removed;
}
