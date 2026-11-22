import { and, eq, gte, isNotNull, isNull } from 'drizzle-orm';
import { getDb } from '../db/client';
import { carrierAccounts, orders, shipments } from '../db/schema';
import { enqueue, JOBS } from '../jobs/queue';
import { getCarrierAdapter, getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { logEvent } from './events';
import { loadOrder, orderRef } from './orders';
import { changeStatus, shipWhenReady } from './workflow';

const CARRIER_NAMES = { inpost: 'InPost', allegro_shipping: 'Allegro Delivery', dpd: 'DPD Polska' } as const;

/** Job: sends the tracking number to the marketplace and marks the order as shipped. */
export async function runPushTracking(shipmentId: string): Promise<void> {
  const db = getDb();
  const [shipment] = await db.select().from(shipments).where(eq(shipments.id, shipmentId));
  if (!shipment || shipment.state !== 'created' || !shipment.trackingNumber || shipment.trackingPushedAt) return;
  const order = await loadOrder(shipment.orderId);
  const account = await loadMarketplaceAccount(order.accountId);

  try {
    await getMarketplaceAdapter(account).pushTracking(await orderRef(order.id), {
      carrier: shipment.carrier,
      carrierCode: shipment.carrierCode,
      carrierName: CARRIER_NAMES[shipment.carrier],
      service: shipment.service,
      trackingNumber: shipment.trackingNumber,
      trackingUrl: shipment.trackingUrl,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await db.update(shipments).set({ trackingPushError: message }).where(eq(shipments.id, shipment.id));
    await logEvent(db, order.id, 'error', `Could not send tracking to ${account.name}: ${message}`);
    throw err;
  }

  await db.update(shipments).set({ trackingPushedAt: new Date(), trackingPushError: null }).where(eq(shipments.id, shipment.id));
  await logEvent(db, order.id, 'tracking', `Tracking ${shipment.trackingNumber} sent to ${account.name}`);
  await shipWhenReady(db, order.id, 'tracking sent and parcel packed');
}

/** Manually re-queues a tracking push that failed. */
export async function retryTrackingPush(shipmentId: string): Promise<void> {
  await getDb().update(shipments).set({ trackingPushError: null }).where(eq(shipments.id, shipmentId));
  await enqueue(JOBS.trackingPush, { shipmentId });
}

/** Job: tells Allegro that the order is being prepared. */
export async function runMarketplaceProcessing(orderId: string): Promise<void> {
  const order = await loadOrder(orderId);
  const account = await loadMarketplaceAccount(order.accountId);
  const adapter = getMarketplaceAdapter(account);
  if (!adapter.markProcessing) return;
  await adapter.markProcessing(await orderRef(order.id));
  await logEvent(getDb(), order.id, 'sync', `${account.name} set to "processing"`);
}

/** Job: checks carriers for shipped parcels and marks delivered orders. */
export async function runDeliveryCheck(): Promise<{ checked: number; delivered: number }> {
  const db = getDb();
  const since = new Date(Date.now() - 30 * 86_400_000);
  const rows = await db
    .select({ shipment: shipments, carrier: carrierAccounts })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .innerJoin(carrierAccounts, eq(carrierAccounts.id, shipments.carrierAccountId))
    .where(and(eq(shipments.state, 'created'), isNull(shipments.deliveredAt), eq(orders.status, 'shipped'), gte(shipments.createdAt, since)));

  let delivered = 0;
  const adapters = new Map<string, Awaited<ReturnType<typeof getCarrierAdapter>>>();
  for (const { shipment, carrier } of rows) {
    if (!shipment.trackingNumber) continue;
    try {
      let adapter = adapters.get(carrier.id);
      if (!adapter) adapters.set(carrier.id, (adapter = await getCarrierAdapter(carrier)));
      if (!adapter.deliveryStatus) continue;
      const status = await adapter.deliveryStatus({
        trackingNumber: shipment.trackingNumber,
        externalId: shipment.externalId,
        carrierCode: shipment.carrierCode,
      });
      if (status === shipment.deliveryStatus) continue;
      await db
        .update(shipments)
        .set({ deliveryStatus: status, ...(status === 'delivered' ? { deliveredAt: new Date() } : {}) })
        .where(eq(shipments.id, shipment.id));
      if (status === 'delivered') {
        delivered++;
        await changeStatus(db, shipment.orderId, 'delivered', { reason: 'carrier reported delivery' });
      }
    } catch (err) {
      console.error(`[delivery-check] ${shipment.trackingNumber}:`, err instanceof Error ? err.message : err);
    }
  }
  return { checked: rows.length, delivered };
}

/** Re-queues every tracking push that failed (e.g. after fixing a carrier code). */
export async function retryFailedTrackingPushes(): Promise<number> {
  const failed = await getDb()
    .select({ id: shipments.id })
    .from(shipments)
    .where(and(eq(shipments.state, 'created'), isNull(shipments.trackingPushedAt), isNotNull(shipments.trackingPushError)));
  for (const s of failed) await retryTrackingPush(s.id);
  return failed.length;
}
