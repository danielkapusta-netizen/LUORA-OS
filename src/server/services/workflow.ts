import { and, desc, eq } from 'drizzle-orm';
import type { Tx } from '../db/client';
import { invoices, orders, shipments, type OrderStatus } from '../db/schema';
import { enqueue, JOBS } from '../jobs/queue';
import { logEvent } from './events';
import { applyOrderStock, restockOrder, scheduleStockPush } from './inventory';

export const STATUS_LABELS: Record<OrderStatus, string> = {
  new: 'New',
  processing: 'Processing',
  label_created: 'Label created',
  shipped: 'Shipped',
  delivered: 'Delivered',
  on_hold: 'On hold',
  cancelled: 'Cancelled',
};

/** Which statuses an order may move to from each status. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  new: ['processing', 'label_created', 'shipped', 'on_hold', 'cancelled'],
  processing: ['new', 'label_created', 'shipped', 'on_hold', 'cancelled'],
  label_created: ['processing', 'shipped', 'on_hold', 'cancelled'],
  shipped: ['delivered'],
  delivered: [],
  on_hold: ['new', 'processing', 'cancelled'],
  cancelled: ['new'],
};

/** Statuses staff can pick by hand; the rest are set by labels, tracking and sync. */
export const MANUAL_TARGETS: OrderStatus[] = ['new', 'processing', 'on_hold', 'shipped', 'cancelled'];

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {}

/** Statuses in which an order is still on the "To do" list. */
const OPEN_STATUSES: OrderStatus[] = ['new', 'processing', 'label_created', 'on_hold'];

/** The order's current label, if it has one that was created. */
async function liveShipment(db: Tx, orderId: string) {
  const [row] = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.orderId, orderId), eq(shipments.state, 'created')))
    .orderBy(desc(shipments.createdAt))
    .limit(1);
  return row ?? null;
}

/**
 * An order with a label becomes "Shipped" only once its tracking has reached the marketplace
 * and staff have ticked "Packed", so it stays on the To do list until the parcel is ready.
 * Returns true when the order was moved to shipped.
 */
export async function shipWhenReady(db: Tx, orderId: string, reason: string, userId?: string | null): Promise<boolean> {
  const shipment = await liveShipment(db, orderId);
  if (!shipment?.trackingPushedAt || !shipment.packedAt) return false;
  const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, orderId));
  if (!order || !OPEN_STATUSES.includes(order.status)) return false;
  await changeStatus(db, orderId, 'shipped', { reason, userId, force: true });
  return true;
}

/** True when the order has a label that is not packed yet (it must stay on the To do list). */
export async function awaitingPacking(db: Tx, orderId: string): Promise<boolean> {
  const shipment = await liveShipment(db, orderId);
  return Boolean(shipment && !shipment.packedAt);
}

/**
 * Moves an order to a new status and runs the side effects:
 * cancelling returns stock, reopening takes it again, and "processing" tells Allegro.
 */
export async function changeStatus(
  db: Tx,
  orderId: string,
  to: OrderStatus,
  options: { userId?: string | null; reason?: string; force?: boolean } = {},
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) throw new TransitionError('Order not found');
  if (order.status === to) return;
  if (!options.force && !canTransition(order.status, to)) {
    throw new TransitionError(`Can't move an order from "${STATUS_LABELS[order.status]}" to "${STATUS_LABELS[to]}"`);
  }

  // Compare-and-set on the old status: without row locks, a concurrent change wins and this one stops.
  const updated = await db
    .update(orders)
    .set({ status: to, ...(to === 'shipped' && !order.shippedAt ? { shippedAt: new Date() } : {}) })
    .where(and(eq(orders.id, orderId), eq(orders.status, order.status)))
    .returning({ id: orders.id });
  if (updated.length === 0) throw new TransitionError('The order changed meanwhile; reload and try again');
  await logEvent(db, orderId, 'status', `${STATUS_LABELS[order.status]} → ${STATUS_LABELS[to]}${options.reason ? ` (${options.reason})` : ''}`, {
    userId: options.userId,
    data: { from: order.status, to },
  });

  if (to === 'cancelled' && order.stockApplied) {
    if (await restockOrder(db, orderId)) await scheduleStockPush();
  }
  if (order.status === 'cancelled' && !order.stockApplied && !order.historical) {
    if (await applyOrderStock(db, orderId)) await scheduleStockPush();
  }
  if (to === 'processing' && order.marketplace === 'allegro' && !order.historical) {
    await enqueue(JOBS.marketplaceProcessing, { orderId });
  }
  // Past orders (history import) were invoiced, or not, before Luora.
  if (to === 'shipped' && order.invoiceRequest && !order.historical) {
    // Issues the invoice the buyer asked for, if automatic invoicing is on (checked by the job).
    await enqueue(JOBS.invoiceAuto, { orderId });
  }
  if (to === 'cancelled') {
    const [issued] = await db
      .select({ number: invoices.number, externalId: invoices.externalId })
      .from(invoices)
      .where(and(eq(invoices.orderId, orderId), eq(invoices.state, 'issued')));
    if (issued) {
      await logEvent(db, orderId, 'invoice', `Order cancelled after invoice ${issued.number ?? issued.externalId} was issued: issue a correction invoice in ifirma`);
    }
  }
}
