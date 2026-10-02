import { and, asc, eq, inArray, isNotNull, isNull, ne, sql } from 'drizzle-orm';
import { getDb, insertMany, insertStatements, type Tx } from '../db/client';
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
import type { Listing, StockUpdate } from '../integrations/types';
import { enqueue, JOBS } from '../jobs/queue';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { logEvent } from './events';
import { createMatcher, isClearSuggestion } from './matching';

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
  if (!product) throw new Error('Product not found');
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
export async function importListings(accountId: string): Promise<{ listings: number; created: number; unmatched: number }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  const adapter = getMarketplaceAdapter(account);
  const isShopify = account.type === 'shopify';
  let count = 0;
  let created = 0;

  for await (const listing of adapter.listListings()) {
    count++;
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
        lastSeenQty: listing.quantity,
        lastSeenAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [productListings.accountId, productListings.externalId],
        set: {
          sku: listing.sku,
          title: isShopify ? cleanShopifyTitle(listing.title) : listing.title,
          // Allegro's list has no barcode; keep the one read from the offer earlier.
          ean: sql`coalesce(${normalizeEan(listing.ean)}, ${productListings.ean})`,
          ref: listing.ref,
          lastSeenQty: listing.quantity,
          lastSeenAt: new Date(),
          // Shopify listings always belong to their own product; other links are kept as made.
          productId: isShopify ? productId : sql`${productListings.productId}`,
        },
      });
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
    .where(and(eq(productListings.accountId, accountId), isNull(products.shopifyVariantId)));
  return { listings: count, created, unmatched };
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
  if (!listing) throw new Error('Listing not found');
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
    .where(and(ne(marketplaceAccounts.type, 'shopify'), isNull(products.shopifyVariantId)))
    .orderBy(asc(marketplaceAccounts.name), asc(productListings.title));
}

/** Listings waiting to be matched, each with up to three Shopify products suggested by name. */
export async function matchingSuggestions() {
  const [pending, catalogue] = await Promise.all([
    needsMatching(),
    getDb().select({ id: products.id, name: products.name }).from(products).where(isNotNull(products.shopifyVariantId)),
  ]);
  const suggest = createMatcher(catalogue);
  return pending.map((l) => {
    const suggestions = suggest(l.title);
    return { listing: l, suggestions, clear: isClearSuggestion(suggestions) };
  });
}

/** Links every waiting listing whose best suggestion is clear. Returns how many were linked. */
export async function confirmClearSuggestions(): Promise<number> {
  let linked = 0;
  for (const { listing, suggestions, clear } of await matchingSuggestions()) {
    if (!clear) continue;
    await linkListing(listing.id, suggestions[0].productId);
    linked++;
  }
  return linked;
}

/** Listings whose marketplace quantity differs from the master stock. */
export function pendingUpdatesFor(
  rows: { listingId: string; externalId: string; sku: string | null; ref: Record<string, string | number | null>; stock: number; lastPushedQty: number | null }[],
): (StockUpdate & { listingId: string })[] {
  return rows
    .filter((r) => r.lastPushedQty !== Math.max(0, r.stock))
    .map((r) => ({ listingId: r.listingId, externalId: r.externalId, sku: r.sku, ref: r.ref, quantity: Math.max(0, r.stock) }));
}

/**
 * Sends master stock to one marketplace account (or only logs it in dry-run mode). Normally only
 * listings whose last push differs; with force, every listing whose marketplace quantity differs.
 */
export async function runStockPush(accountId: string, opts: { force?: boolean } = {}): Promise<{ pushed: number; dryRun: boolean }> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  if (!account.stockSyncEnabled || !account.enabled) return { pushed: 0, dryRun: account.stockDryRun };

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
    })
    .from(productListings)
    .innerJoin(products, eq(products.id, productListings.productId))
    // Only listings matched to a Shopify product; the rest wait under "Needs matching".
    .where(and(eq(productListings.accountId, accountId), isNotNull(products.shopifyVariantId)))
    .orderBy(asc(productListings.id));
  const updates = opts.force
    ? pendingUpdatesFor(rows.map((r) => ({ ...r, lastPushedQty: marketplaceQuantity(r) })))
    : pendingUpdatesFor(rows);
  if (updates.length === 0) return { pushed: 0, dryRun: account.stockDryRun };

  if (account.stockDryRun) {
    // Nothing is sent, so the same difference would be logged on every push; only log changes.
    const lastLogged = await db.all<{ listing_id: string; quantity: number }>(sql`
      select l.listing_id, l.quantity from stock_sync_log l
      where l.account_id = ${accountId} and l.dry_run = 1
        and l.created_at = (select max(x.created_at) from stock_sync_log x where x.listing_id = l.listing_id and x.dry_run = 1)`);
    const previous = new Map(lastLogged.map((r) => [r.listing_id, r.quantity]));
    const fresh = updates.filter((u) => previous.get(u.listingId) !== u.quantity);
    if (fresh.length) {
      await insertMany(db, stockSyncLog, fresh.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: true, ok: true })));
    }
    return { pushed: fresh.length, dryRun: true };
  }

  try {
    await getMarketplaceAdapter(account).setStock(updates);
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

  const now = new Date();
  for (const u of updates) {
    await db
      .update(productListings)
      .set({ lastPushedQty: u.quantity, lastPushedAt: now, lastPushError: null })
      .where(eq(productListings.id, u.listingId));
  }
  await insertMany(
    db,
    stockSyncLog,
    updates.map((u) => ({ accountId, listingId: u.listingId, quantity: u.quantity, dryRun: false, ok: true })),
  );
  return { pushed: updates.length, dryRun: false };
}

/**
 * "Sync all stocks": re-reads every marketplace (Shopify first, as it defines the products), then
 * sends the master stock wherever a marketplace shows a different number. Accounts in dry run only log.
 */
export async function syncAllStock(): Promise<void> {
  const accounts = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(eq(marketplaceAccounts.enabled, true))
    .orderBy(sql`${marketplaceAccounts.type} = 'shopify' desc`);
  for (const account of accounts) {
    try {
      await importListings(account.id);
    } catch (err) {
      console.error(`[stock sync] import ${account.name}:`, err);
    }
  }
  for (const account of accounts.filter((a) => a.stockSyncEnabled)) {
    await enqueue(JOBS.stockPush, { accountId: account.id, force: true });
  }
}

/** Nightly: re-reads listing quantities so the inventory page can show drift. */
export async function runReconcile(): Promise<void> {
  const accounts = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.enabled, true), eq(marketplaceAccounts.stockSyncEnabled, true)));
  for (const account of accounts) {
    try {
      await importListings(account.id);
    } catch (err) {
      console.error(`[reconcile] ${account.name}:`, err);
    }
  }
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
    })
    .from(productListings)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, productListings.accountId))
    .where(isNotNull(productListings.productId))
    .orderBy(asc(marketplaceAccounts.type), asc(productListings.title));
  return { products: productRows, listings: listingRows };
}

/** What the marketplace most likely shows now: our last push, unless an import read it later. */
export function marketplaceQuantity(l: { lastSeenQty: number | null; lastSeenAt: Date | null; lastPushedQty: number | null; lastPushedAt: Date | null }): number | null {
  if (l.lastPushedAt && l.lastPushedQty !== null && (!l.lastSeenAt || l.lastPushedAt >= l.lastSeenAt)) return l.lastPushedQty;
  return l.lastSeenQty;
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
