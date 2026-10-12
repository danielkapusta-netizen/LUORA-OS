import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, like, lte, ne, or, sql, type SQL } from 'drizzle-orm';
import { courierOf, type Courier } from '../../lib/couriers';
import { chunk, getDb, insertStatements, type Tx } from '../db/client';
import {
  marketplaceAccounts,
  orderEvents,
  orderFees,
  orderItems,
  orderRefunds,
  orders,
  productListings,
  products,
  shipments,
  users,
  type FeeSource,
  type MarketplaceAccount,
  type Order,
  type OrderStatus,
} from '../db/schema';
import type { MarketplaceAdapter } from '../integrations/marketplaces/types';
import type { Address, NormalizedOrder, OrderRef } from '../integrations/types';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { logEvent } from './events';
import { applyOrderStock, scheduleStockPush, stockCoversOrder } from './inventory';
import { resolveCustomers } from './customers';
import { refreshProfit } from './profit';
import { awaitingPacking, changeStatus } from './workflow';

const MAX_ROUNDS_PER_SYNC = 20;

export interface SyncSummary {
  created: number;
  updated: number;
}

/** Pulls new and changed orders for one marketplace account. */
export async function syncAccount(accountId: string): Promise<SyncSummary> {
  const db = getDb();
  const account = await loadMarketplaceAccount(accountId);
  if (!account.enabled) return { created: 0, updated: 0 };

  const summary: SyncSummary = { created: 0, updated: 0 };
  try {
    const adapter = getMarketplaceAdapter(account);
    let cursor = account.syncCursor;
    for (let round = 0; round < MAX_ROUNDS_PER_SYNC; round++) {
      const result = await adapter.syncOrders(cursor);
      const stored = await upsertOrders(account, result.orders);
      summary.created += stored.created;
      summary.updated += stored.updated;
      // Only move the cursor once the orders are safely stored.
      cursor = result.nextCursor;
      await db.update(marketplaceAccounts).set({ syncCursor: cursor }).where(eq(marketplaceAccounts.id, account.id));
      if (stored.newOrderIds.length && account.settings.autoAccept && adapter.acceptOrder) {
        await autoAccept(account, adapter, stored.newOrderIds);
      }
      if (!result.hasMore) break;
    }
    await db
      .update(marketplaceAccounts)
      .set({ lastSyncedAt: new Date(), lastError: null })
      .where(eq(marketplaceAccounts.id, account.id));
    return summary;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(marketplaceAccounts).set({ lastError: message }).where(eq(marketplaceAccounts.id, account.id));
    throw err;
  }
}

function initialStatus(n: NormalizedOrder, historical: boolean): OrderStatus {
  if (n.cancelled) return 'cancelled';
  // A past order was dealt with outside Luora (or before it): it is closed, never put on To do.
  if (n.fulfilled || historical) return 'shipped';
  return 'new';
}

/** Where fees reported inside an order come from, by marketplace. */
const FEE_SOURCE: Partial<Record<MarketplaceAccount['type'], FeeSource>> = {
  shopify: 'shopify_payments',
  empik: 'mirakl',
  allegro: 'allegro_billing',
};

/** The import event. An order that reaches us days after it was placed says so, so it doesn't look new. */
export function importMessage(accountName: string, placedAt: Date, now = new Date()): string {
  const days = Math.floor((now.getTime() - placedAt.getTime()) / 86_400_000);
  return days > 3 ? `Imported from ${accountName} (placed ${days} days ago)` : `Imported from ${accountName}`;
}

/** Statuses in which the buyer's data may still be refreshed from the marketplace. */
const EDITABLE: OrderStatus[] = ['new', 'processing', 'on_hold'];

export async function upsertOrders(
  account: Pick<MarketplaceAccount, 'id' | 'type' | 'name'>,
  incoming: NormalizedOrder[],
  /** historical: past orders from the history import (no stock, labels or invoices). */
  options: { historical?: boolean } = {},
): Promise<SyncSummary & { newOrderIds: string[] }> {
  const historical = options.historical ?? false;
  const db = getDb();
  const newOrderIds: string[] = [];
  let created = 0;
  let updated = 0;
  /** Orders whose profit lines need rebuilding. */
  const touched: string[] = [];
  let stockChanged = false;

  for (const n of incoming) {
    await (async () => {
      const tx = db;
      const [existing] = await tx
        .select()
        .from(orders)
        .where(and(eq(orders.accountId, account.id), eq(orders.externalId, n.externalId)));

      if (!existing) {
        // Order, items and the import event land together in one D1 batch (atomic).
        const id = crypto.randomUUID();
        const insertOrder = tx.insert(orders).values({
            id,
            accountId: account.id,
            marketplace: account.type,
            externalId: n.externalId,
            externalNumber: n.externalNumber,
            marketplaceStatus: n.marketplaceStatus,
            readyToShip: n.readyToShip,
            status: initialStatus(n, historical),
            buyer: n.buyer,
            shippingAddress: n.shippingAddress,
            deliveryMethodId: n.deliveryMethodId ?? null,
            deliveryMethodName: n.deliveryMethodName ?? null,
            pickupPointId: n.pickupPointId ?? null,
            codAmount: n.codAmount ?? null,
            totalAmount: n.totalAmount,
            shippingAmount: n.shippingAmount ?? null,
            currency: n.currency,
            placedAt: n.placedAt,
            paidAt: n.paidAt ?? null,
            shippedAt: n.fulfilled && !historical ? new Date() : null,
            revision: n.revision ?? null,
            invoiceRequest: n.invoiceRequest ?? null,
            discountAmount: n.discountAmount ?? null,
            historical,
            raw: n.raw as object,
          });
        await tx.batch([
          insertOrder,
          ...(await itemStatements(tx, account.id, id, n)),
          tx.insert(orderEvents).values({
            orderId: id,
            type: 'sync',
            message: historical ? `Imported from ${account.name} history` : importMessage(account.name, n.placedAt),
          }),
        ] as unknown as Parameters<Tx['batch']>[0]);
        await storeMoneyEvents(tx, account.type, id, n);
        created++;
        touched.push(id);
        if (historical) return;
        if (!n.cancelled && !n.fulfilled) stockChanged = (await applyOrderStock(tx, id)) || stockChanged;
        newOrderIds.push(id);
        return;
      }

      updated++;
      touched.push(existing.id);
      await tx
        .update(orders)
        .set({
          marketplaceStatus: n.marketplaceStatus,
          readyToShip: n.readyToShip,
          revision: n.revision ?? null,
          paidAt: n.paidAt ?? existing.paidAt,
          // Buyers can add invoice details after buying, so this always follows the marketplace.
          invoiceRequest: n.invoiceRequest ?? null,
          discountAmount: n.discountAmount ?? existing.discountAmount,
          raw: n.raw as object,
          ...(EDITABLE.includes(existing.status)
            ? {
                buyer: n.buyer,
                shippingAddress: n.shippingAddress,
                deliveryMethodId: n.deliveryMethodId ?? null,
                deliveryMethodName: n.deliveryMethodName ?? null,
                // Keep a locker code staff typed in by hand.
                pickupPointId: existing.pickupPointId ?? n.pickupPointId ?? null,
                codAmount: n.codAmount ?? null,
                totalAmount: n.totalAmount,
              }
            : {}),
        })
        .where(eq(orders.id, existing.id));

      // Discounts can change after the order (e.g. a price correction); the lines follow the marketplace.
      for (const item of n.items) {
        if (item.discountAmount === undefined) continue;
        await tx
          .update(orderItems)
          .set({ discountAmount: item.discountAmount ?? null })
          .where(and(eq(orderItems.orderId, existing.id), eq(orderItems.externalLineId, item.externalLineId)));
      }
      await storeMoneyEvents(tx, account.type, existing.id, n);

      // Fill in product photos for orders imported before photos were stored.
      for (const item of n.items) {
        if (!item.imageUrl) continue;
        await tx
          .update(orderItems)
          .set({ imageUrl: item.imageUrl })
          .where(
            and(
              eq(orderItems.orderId, existing.id),
              eq(orderItems.externalLineId, item.externalLineId),
              // Relative paths are Empik photos stored before they were made absolute.
              or(isNull(orderItems.imageUrl), like(orderItems.imageUrl, '/%')),
            ),
          );
      }
      // The marketplace (e.g. Allegro, Empik) may have no photo of its own; fall back to the product's.
      await tx.run(sql`
        update order_items set image_url = (select p.image_url from products p where p.sku = order_items.sku)
        where order_id = ${existing.id} and image_url is null and sku is not null
          and exists (select 1 from products p where p.sku = order_items.sku and p.image_url is not null)`);

      if (n.marketplaceStatus !== existing.marketplaceStatus) {
        await logEvent(tx, existing.id, 'sync', `Marketplace status: ${existing.marketplaceStatus} → ${n.marketplaceStatus}`);
      }
      if (n.cancelled && !['cancelled', 'shipped', 'delivered'].includes(existing.status)) {
        await changeStatus(tx, existing.id, 'cancelled', { reason: 'cancelled on the marketplace', force: true });
      } else if (n.fulfilled && ['new', 'processing', 'label_created', 'on_hold'].includes(existing.status) && !(await awaitingPacking(tx, existing.id))) {
        // Our own label marks the order shipped on the marketplace right away; it stays on To do until packed.
        await changeStatus(tx, existing.id, 'shipped', { reason: 'shipped on the marketplace', force: true });
      }
    })();
  }

  if (stockChanged) await scheduleStockPush();
  // Customers first, so the profit lines carry the customer.
  await linkCustomers(touched);
  await refreshProfit(touched);
  return { created, updated, newOrderIds };
}

/** Never lets a CRM problem break the order sync. */
async function linkCustomers(orderIds: string[]): Promise<void> {
  if (!orderIds.length) return;
  try {
    await resolveCustomers(orderIds);
  } catch (err) {
    console.error('[customers] linking failed; the backfill will retry:', err instanceof Error ? err.message : err);
  }
}

/**
 * Saves the fees and refunds an order payload reports. Re-imports update them in place (keyed by
 * the provider's id), so they are never counted twice.
 */
async function storeMoneyEvents(tx: Tx, marketplace: MarketplaceAccount['type'], orderId: string, n: NormalizedOrder): Promise<void> {
  const source = FEE_SOURCE[marketplace];
  const fees = source ? (n.fees ?? []) : [];
  const refunds = n.refunds ?? [];
  if (!fees.length && !refunds.length) return;
  const lines = await tx.select({ id: orderItems.id, externalLineId: orderItems.externalLineId }).from(orderItems).where(eq(orderItems.orderId, orderId));
  const itemId = (externalLineId: string | null | undefined) => (externalLineId ? (lines.find((l) => l.externalLineId === externalLineId)?.id ?? null) : null);
  for (const f of fees) {
    const values = {
      orderItemId: itemId(f.externalLineId),
      kind: f.kind,
      label: f.label ?? null,
      amount: f.amount,
      taxAmount: f.taxAmount ?? null,
      currency: f.currency,
      occurredAt: f.occurredAt,
    };
    await tx
      .insert(orderFees)
      .values({ orderId, source: source!, externalId: f.externalId, ...values })
      .onConflictDoUpdate({ target: [orderFees.source, orderFees.externalId], set: { orderId, ...values } });
  }
  for (const r of refunds) {
    const values = {
      orderItemId: itemId(r.externalLineId),
      amount: r.amount,
      currency: r.currency,
      quantity: r.quantity ?? null,
      restocked: r.restocked ?? false,
      refundedAt: r.refundedAt,
    };
    await tx
      .insert(orderRefunds)
      .values({ orderId, externalId: r.externalId, ...values })
      .onConflictDoUpdate({ target: [orderRefunds.orderId, orderRefunds.externalId], set: values });
  }
}

async function itemStatements(tx: Tx, accountId: string, orderId: string, n: NormalizedOrder) {
  if (n.items.length === 0) return [];
  const skus = [...new Set(n.items.map((i) => i.sku).filter((s): s is string => Boolean(s)))];
  const known = skus.length
    ? await tx.select({ id: products.id, sku: products.sku, imageUrl: products.imageUrl }).from(products).where(inArray(products.sku, skus))
    : [];
  const bySku = new Map(known.map((p) => [p.sku, p]));
  // The offer / variant a line was bought from is linked to its product on the Inventory page;
  // that link wins over the SKU (Allegro offers have none, Empik uses its own).
  const offerIds = [...new Set(n.items.map((i) => i.externalProductId).filter((s): s is string => Boolean(s)))];
  const linked = offerIds.length
    ? await tx
        .select({ externalId: productListings.externalId, id: products.id, imageUrl: products.imageUrl })
        .from(productListings)
        .innerJoin(products, eq(products.id, productListings.productId))
        .where(and(eq(productListings.accountId, accountId), inArray(productListings.externalId, offerIds)))
    : [];
  const byOffer = new Map(linked.map((p) => [p.externalId, p]));
  const productFor = (i: NormalizedOrder['items'][number]) =>
    (i.externalProductId ? byOffer.get(i.externalProductId) : undefined) ?? (i.sku ? bySku.get(i.sku) : undefined);
  return insertStatements(
    tx,
    orderItems,
    n.items.map((i) => ({
      orderId,
      externalLineId: i.externalLineId,
      sku: i.sku,
      name: i.name,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      externalProductId: i.externalProductId ?? null,
      // Allegro and Empik don't always send a photo; fall back to the product's (from Shopify).
      imageUrl: i.imageUrl ?? productFor(i)?.imageUrl ?? null,
      productId: productFor(i)?.id ?? null,
      discountAmount: i.discountAmount ?? null,
    })),
  );
}

/** Empik: accept new orders that wait for the seller when stock covers them. */
async function autoAccept(account: MarketplaceAccount, adapter: MarketplaceAdapter, orderIds: string[]): Promise<void> {
  const db = getDb();
  const waiting = await db
    .select()
    .from(orders)
    .where(and(inArray(orders.id, orderIds), eq(orders.marketplaceStatus, 'WAITING_ACCEPTANCE')));
  for (const order of waiting) {
    if (!(await stockCoversOrder(db, order.id))) {
      await logEvent(db, order.id, 'sync', 'Not accepted automatically: not enough stock');
      continue;
    }
    await acceptOrder(order.id, null, { account, adapter });
  }
}

export async function acceptOrder(
  orderId: string,
  userId: string | null,
  ctx?: { account: MarketplaceAccount; adapter: MarketplaceAdapter },
): Promise<void> {
  const db = getDb();
  const order = await loadOrder(orderId);
  const account = ctx?.account ?? (await loadMarketplaceAccount(order.accountId));
  const adapter = ctx?.adapter ?? getMarketplaceAdapter(account);
  if (!adapter.acceptOrder) throw new Error(`${account.name} does not need orders to be accepted`);
  await adapter.acceptOrder(await orderRef(order.id));
  await logEvent(db, order.id, 'sync', userId ? 'Accepted on the marketplace' : 'Accepted automatically', { userId });
  const fresh = await adapter.getOrder(order.externalId);
  if (fresh) await upsertOrders(account, [fresh]);
}

/** Re-reads one order from its marketplace. */
export async function refreshOrder(orderId: string): Promise<void> {
  const order = await loadOrder(orderId);
  const account = await loadMarketplaceAccount(order.accountId);
  const fresh = await getMarketplaceAdapter(account).getOrder(order.externalId);
  if (!fresh) throw new Error('The marketplace no longer returns this order');
  await upsertOrders(account, [fresh]);
}

const LOCKER_METHOD = /paczkomat|packstation|parcel.?locker/i;

/**
 * For automatic labels: an order whose buyer chose a Paczkomat must never fall through to a
 * courier rule just because its locker code is missing. Re-reads it from the marketplace once;
 * if the code is still missing, stops with a message instead of guessing.
 * Allegro is skipped: Allegro Delivery ships with the buyer's own method and point.
 */
export async function withPickupPoint(order: Order): Promise<Order> {
  if (order.pickupPointId || order.marketplace === 'allegro') return order;
  if (!LOCKER_METHOD.test(`${order.deliveryMethodId ?? ''} ${order.deliveryMethodName ?? ''}`)) return order;
  await refreshOrder(order.id);
  const fresh = await loadOrder(order.id);
  if (!fresh.pickupPointId) {
    throw new Error(`The buyer chose "${order.deliveryMethodName}" but ${order.marketplace} sent no Paczkomat code. Enter it in the full order.`);
  }
  return fresh;
}

const BACKFILL_LIMIT = 20;

/**
 * Re-reads orders whose stored data is incomplete. Regular sync only revisits orders with new
 * marketplace events, so these would otherwise stay incomplete:
 * - orders that asked for an invoice before invoice requests were stored;
 * - open Empik Paczkomat orders without a pickup point (imported before the point was read);
 * - items without a photo, or with a relative Empik photo path: the per-item lookup (e.g. Allegro's
 *   offer photo, a separate call per offer) can fail or get rate-limited during a big sync.
 */
export async function backfillOrderDetails(limit = BACKFILL_LIMIT): Promise<{ checked: number; refreshed: number }> {
  const db = getDb();
  const lockers = await db
    .select({ orderId: orders.id })
    .from(orders)
    .where(
      and(
        eq(orders.marketplace, 'empik'),
        eq(orders.deliveryMethodId, 'PACKSTATION'),
        isNull(orders.pickupPointId),
        inArray(orders.status, EDITABLE),
        eq(orders.historical, false),
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(limit);
  const photos = await db
    .selectDistinct({ orderId: orderItems.orderId })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .where(
      and(
        or(isNull(orderItems.imageUrl), like(orderItems.imageUrl, '/%')),
        or(isNotNull(orderItems.sku), isNotNull(orderItems.externalProductId)),
        ne(orders.status, 'cancelled'),
        // Past orders are many and take their photo from the product instead.
        eq(orders.historical, false),
      ),
    )
    .orderBy(desc(orders.placedAt))
    .limit(limit);
  // Orders that asked for an invoice before invoice requests were stored.
  const invoices = await db
    .select({ orderId: orders.id })
    .from(orders)
    .where(
      and(
        isNull(orders.invoiceRequest),
        ne(orders.status, 'cancelled'),
        eq(orders.historical, false),
        or(
          sql`${orders.marketplace} = 'allegro' and json_extract(${orders.raw}, '$.invoice.required') = 1`,
          sql`${orders.marketplace} = 'empik' and exists (select 1 from json_each(${orders.raw}, '$.order_additional_fields') f where json_extract(f.value, '$.code') = 'nip')`,
        ),
      ),
    )
    .limit(limit);
  const ids = [...new Set([...invoices, ...lockers, ...photos].map((r) => r.orderId))].slice(0, limit);

  let refreshed = 0;
  for (const orderId of ids) {
    try {
      await refreshOrder(orderId);
      refreshed++;
    } catch (err) {
      console.error(`[order-backfill] ${orderId}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: ids.length, refreshed };
}

export async function loadOrder(orderId: string): Promise<Order> {
  const [order] = await getDb().select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new Error('Order not found');
  return order;
}

export async function orderRef(orderId: string): Promise<OrderRef> {
  const order = await loadOrder(orderId);
  const items = await getDb()
    .select({ externalLineId: orderItems.externalLineId, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));
  return { externalId: order.externalId, externalNumber: order.externalNumber, raw: order.raw, items };
}

// ---------------------------------------------------------------- queries

export interface OrderFilters {
  q?: string;
  status?: OrderStatus | 'open';
  marketplace?: string;
  accountId?: string;
  assigneeId?: string;
  tag?: string;
  carrier?: string;
  /** Only orders whose buyer asked for an invoice. */
  invoiceRequested?: boolean;
  from?: string;
  to?: string;
  /** Only orders whose customer ordered (and did not cancel) before. */
  returning?: boolean;
  page?: number;
}

export const PAGE_SIZE = 50;
const OPEN: OrderStatus[] = ['new', 'processing', 'label_created', 'on_hold'];

function filterConditions(f: OrderFilters): SQL[] {
  const where: SQL[] = [];
  if (f.status === 'open') where.push(inArray(orders.status, OPEN));
  else if (f.status) where.push(eq(orders.status, f.status));
  if (f.marketplace) where.push(sql`${orders.marketplace} = ${f.marketplace}`);
  if (f.accountId) where.push(eq(orders.accountId, f.accountId));
  if (f.assigneeId) where.push(eq(orders.assigneeId, f.assigneeId));
  if (f.invoiceRequested) where.push(isNotNull(orders.invoiceRequest));
  if (f.returning) {
    where.push(sql`exists (select 1 from orders o2 where o2.customer_id = ${orders.customerId} and o2.status <> 'cancelled' and o2.placed_at < ${orders.placedAt})`);
  }
  if (f.tag) where.push(sql`exists (select 1 from json_each(${orders.tags}) t where t.value = ${f.tag})`);
  if (f.from) where.push(gte(orders.placedAt, new Date(f.from)));
  if (f.to) where.push(lte(orders.placedAt, new Date(`${f.to}T23:59:59`)));
  if (f.carrier) {
    where.push(
      sql`exists (select 1 from ${shipments} s where s.order_id = ${orders.id} and s.carrier = ${f.carrier} and s.state <> 'cancelled')`,
    );
  }
  if (f.q) {
    const pattern = `%${f.q.trim()}%`;
    where.push(
      or(
        // SQLite LIKE is case-insensitive for ASCII.
        like(orders.externalNumber, pattern),
        like(orders.externalId, pattern),
        like(orders.deliveryMethodName, pattern),
        like(orders.pickupPointId, pattern),
        sql`json_extract(${orders.buyer}, '$.name') like ${pattern}`,
        sql`json_extract(${orders.buyer}, '$.email') like ${pattern}`,
        sql`exists (select 1 from ${shipments} s where s.order_id = ${orders.id} and s.tracking_number like ${pattern})`,
        sql`exists (select 1 from ${orderItems} i where i.order_id = ${orders.id} and (i.sku like ${pattern} or i.name like ${pattern}))`,
      )!,
    );
  }
  return where;
}

export interface ReturningInfo {
  /** 2 for the second order, 3 for the third... */
  orderNumber: number;
  firstOrderAt: Date;
}

/** For orders whose customer ordered (and did not cancel) before: which order of theirs this is, and when they first ordered. */
export async function returningInfo(rows: { id: string; customerId: string | null; placedAt: Date }[]): Promise<Map<string, ReturningInfo>> {
  const result = new Map<string, ReturningInfo>();
  const customerIds = [...new Set(rows.map((r) => r.customerId).filter((c): c is string => Boolean(c)))];
  if (customerIds.length === 0) return result;
  const history = new Map<string, Date[]>();
  for (const ids of chunk(customerIds)) {
    const found = await getDb()
      .select({ customerId: orders.customerId, placedAt: orders.placedAt })
      .from(orders)
      .where(and(inArray(orders.customerId, ids), ne(orders.status, 'cancelled')));
    for (const f of found) history.set(f.customerId!, [...(history.get(f.customerId!) ?? []), f.placedAt]);
  }
  for (const r of rows) {
    if (!r.customerId) continue;
    const earlier = (history.get(r.customerId) ?? []).filter((d) => d.getTime() < r.placedAt.getTime());
    if (earlier.length === 0) continue;
    result.set(r.id, { orderNumber: earlier.length + 1, firstOrderAt: new Date(Math.min(...earlier.map((d) => d.getTime()))) });
  }
  return result;
}

export async function listOrders(f: OrderFilters) {
  const db = getDb();
  const where = and(...filterConditions(f));
  const page = Math.max(1, f.page ?? 1);

  const rows = await db
    .select({
      order: orders,
      accountName: marketplaceAccounts.name,
      assigneeName: users.name,
      itemCount: sql<number>`(select coalesce(sum(quantity), 0) from ${orderItems} i where i.order_id = ${orders.id})`,
    })
    .from(orders)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, orders.accountId))
    .leftJoin(users, eq(users.id, orders.assigneeId))
    .where(where)
    .orderBy(desc(orders.placedAt))
    .limit(PAGE_SIZE)
    .offset((page - 1) * PAGE_SIZE);

  const [{ count }] = await db.select({ count: sql<number>`count(*)` }).from(orders).where(where);

  const ids = rows.map((r) => r.order.id);
  const live = ids.length
    ? await db
        .select()
        .from(shipments)
        .where(and(inArray(shipments.orderId, ids), ne(shipments.state, 'cancelled')))
        .orderBy(desc(shipments.createdAt))
    : [];
  const latest = new Map<string, (typeof live)[number]>();
  for (const s of live) if (!latest.has(s.orderId)) latest.set(s.orderId, s);

  const returning = await returningInfo(rows.map((r) => ({ id: r.order.id, customerId: r.order.customerId, placedAt: r.order.placedAt })));
  return { rows: rows.map((r) => ({ ...r, shipment: latest.get(r.order.id) ?? null, returning: returning.get(r.order.id) ?? null })), total: count, page, pageSize: PAGE_SIZE };
}

export async function statusCounts(): Promise<Record<string, number>> {
  const rows = await getDb()
    .select({ status: orders.status, count: sql<number>`count(*)` })
    .from(orders)
    .groupBy(orders.status);
  return Object.fromEntries(rows.map((r) => [r.status, r.count]));
}

/** Orders still to be packed and sent (not on hold), grouped by the courier the buyer chose. Busiest first. */
export async function ordersToShipByCourier(): Promise<{ courier: Courier; count: number; labelled: number }[]> {
  const rows = await getDb()
    .select({ method: orders.deliveryMethodName, status: orders.status, carrier: sql<string | null>`(select s.carrier from shipments s where s.order_id = ${orders.id} and s.state != 'cancelled' order by s.created_at desc limit 1)` })
    .from(orders)
    .where(and(inArray(orders.status, ['new', 'processing', 'label_created']), eq(orders.historical, false)));
  const byCourier = new Map<Courier, { count: number; labelled: number }>();
  for (const r of rows) {
    const courier = courierOf(r.method, r.carrier);
    const entry = byCourier.get(courier) ?? { count: 0, labelled: 0 };
    entry.count += 1;
    if (r.status === 'label_created') entry.labelled += 1;
    byCourier.set(courier, entry);
  }
  return [...byCourier].map(([courier, v]) => ({ courier, ...v })).sort((a, b) => b.count - a.count || a.courier.localeCompare(b.courier));
}

/** Items of many orders at once (e.g. for the Shipments pages), keyed by order id. */
export async function itemsByOrder(orderIds: string[]) {
  const byOrder = new Map<string, (typeof orderItems.$inferSelect)[]>();
  for (const ids of chunk([...new Set(orderIds)])) {
    const rows = await getDb().select().from(orderItems).where(inArray(orderItems.orderId, ids)).orderBy(asc(orderItems.externalLineId));
    for (const row of rows) byOrder.set(row.orderId, [...(byOrder.get(row.orderId) ?? []), row]);
  }
  return byOrder;
}

export async function getOrderDetail(orderId: string) {
  const db = getDb();
  const [row] = await db
    .select({ order: orders, account: marketplaceAccounts })
    .from(orders)
    .innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, orders.accountId))
    .where(eq(orders.id, orderId));
  if (!row) return null;
  const [items, events, orderShipments] = await Promise.all([
    db.select().from(orderItems).where(eq(orderItems.orderId, orderId)).orderBy(asc(orderItems.externalLineId)),
    db
      .select({ event: orderEvents, userName: users.name })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.userId))
      .where(eq(orderEvents.orderId, orderId))
      .orderBy(desc(orderEvents.createdAt)),
    db.select().from(shipments).where(eq(shipments.orderId, orderId)).orderBy(desc(shipments.createdAt)),
  ]);
  return { ...row, items, events, shipments: orderShipments };
}

// ---------------------------------------------------------------- edits

export async function addNote(orderId: string, userId: string, text: string): Promise<void> {
  const note = text.trim();
  if (!note) return;
  await logEvent(getDb(), orderId, 'note', note, { userId });
}

export async function assignOrder(orderIds: string[], assigneeId: string | null, userId: string): Promise<void> {
  const db = getDb();
  await db.update(orders).set({ assigneeId }).where(inArray(orders.id, orderIds));
  const [assignee] = assigneeId ? await db.select({ name: users.name }).from(users).where(eq(users.id, assigneeId)) : [];
  for (const id of orderIds) {
    await logEvent(db, id, 'edit', assignee ? `Assigned to ${assignee.name}` : 'Unassigned', { userId });
  }
}

export async function setTags(orderId: string, tags: string[], userId: string): Promise<void> {
  const clean = [...new Set(tags.map((t) => t.trim().toLowerCase()).filter(Boolean))];
  await getDb().update(orders).set({ tags: clean }).where(eq(orders.id, orderId));
  await logEvent(getDb(), orderId, 'edit', clean.length ? `Tags: ${clean.join(', ')}` : 'Tags cleared', { userId });
}

export async function updateShippingDetails(
  orderId: string,
  input: { address: Address; pickupPointId: string | null },
  userId: string,
): Promise<void> {
  const db = getDb();
  await db
    .update(orders)
    .set({ shippingAddress: input.address, pickupPointId: input.pickupPointId || null })
    .where(eq(orders.id, orderId));
  await logEvent(db, orderId, 'edit', 'Shipping address or pickup point edited', { userId });
}

export async function listTags(): Promise<string[]> {
  const rows = await getDb().all<{ tag: string }>(sql`select distinct t.value as tag from orders, json_each(orders.tags) t order by 1`);
  return rows.map((r) => r.tag);
}
