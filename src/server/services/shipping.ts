import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { PDFDocument } from 'pdf-lib';
import { getCfEnv } from '../cf';
import { chunk, getDb } from '../db/client';
import {
  carrierAccounts,
  labelFiles,
  orderEvents,
  orderItems,
  orders,
  packagePresets,
  shipmentBatches,
  shipments,
  shippingRules,
  type CarrierAccount,
  type Order,
  type PackagePreset,
  type Shipment,
  type ShipmentOptions,
} from '../db/schema';
import { declaredValue, deliveryMethodOf, isInsuranceRequiredError, isPacketaMethod } from '../integrations/carriers/allegro-shipping/insurance';
import type { CarrierService, ShipmentStatus } from '../integrations/carriers/types';
import type { LabelFormat, LabelSize, ParcelSpec } from '../integrations/types';
import { enqueue, JOBS } from '../jobs/queue';
import { getCarrierAdapter, loadCarrierAccount, withConfigured } from './accounts';
import { logEvent } from './events';
import { loadOrder, withPickupPoint } from './orders';
import { carrierSupportsOrder, chooseRoute, type RouteDecision } from './routing';
import { changeStatus, shipWhenReady } from './workflow';

/** Give up polling a pending shipment after this many attempts. */
const MAX_POLLS = 40;

export class ShippingError extends Error {}

export function presetToParcel(preset: PackagePreset): ParcelSpec {
  return {
    lengthCm: preset.lengthCm,
    widthCm: preset.widthCm,
    heightCm: preset.heightCm,
    weightKg: Number(preset.weightKg),
    inpostTemplate: (preset.inpostTemplate as ParcelSpec['inpostTemplate']) ?? null,
  };
}

export async function loadRoutingData() {
  const db = getDb();
  const [rules, carriers, presets] = await Promise.all([
    db.select().from(shippingRules).orderBy(asc(shippingRules.priority)),
    db.select().from(carrierAccounts).orderBy(asc(carrierAccounts.name)).then(withConfigured),
    db.select().from(packagePresets).orderBy(asc(packagePresets.name)),
  ]);
  return { rules, carriers, presets };
}

export function routeOrder(order: Order, data: Awaited<ReturnType<typeof loadRoutingData>>): RouteDecision | null {
  return chooseRoute(order, data.rules, data.carriers);
}

/** Everything the "Create label" form needs, pre-filled from the shipping rules. */
export async function shippingFormData(orderId: string) {
  const order = await loadOrder(orderId);
  const data = await loadRoutingData();
  const route = routeOrder(order, data);
  const carriers = data.carriers.filter((c) => c.enabled && carrierSupportsOrder(c, order));
  const services: Record<string, CarrierService[]> = {};
  for (const carrier of carriers) {
    try {
      services[carrier.id] = await (await getCarrierAdapter(carrier)).services();
    } catch {
      services[carrier.id] = [];
    }
  }
  const defaultPreset = data.presets.find((p) => p.id === route?.packagePresetId) ?? data.presets.find((p) => p.isDefault) ?? data.presets[0];
  return { order, route, carriers, services, presets: data.presets, defaultPreset: defaultPreset ?? null };
}

export interface ShipmentInput {
  orderId: string;
  carrierAccountId: string;
  service: string;
  parcel: ParcelSpec;
  options: ShipmentOptions;
  labelFormat?: LabelFormat;
  labelSize?: LabelSize;
  batchId?: string | null;
}

/** InPost and Allegro Delivery both accept at most 100 characters. */
const REFERENCE_MAX = 100;
/** Per-product name length when a parcel holds several products. */
const NAME_MAX = 30;

function shortName(name: string, max: number): string {
  const clean = name.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  return cut.slice(0, cut.lastIndexOf(' ') > 10 ? cut.lastIndexOf(' ') : max).trim();
}

/**
 * Label reference: order number, then the products in the parcel by name, e.g.
 * "40102409712336: 1x Arencia Vitamin C Booster Shot rozświetlające serum". A single product
 * gets the whole length; several are shortened so they all fit.
 */
export function labelReference(orderNumber: string, items: { name: string; quantity: number }[]): string {
  const nameMax = items.length === 1 ? REFERENCE_MAX : NAME_MAX;
  const products = items.map((i) => `${i.quantity}x ${shortName(i.name, nameMax)}`).join(', ');
  const ref = products ? `${orderNumber}: ${products}` : orderNumber;
  return ref.length > REFERENCE_MAX ? `${ref.slice(0, REFERENCE_MAX - 3).trimEnd()}...` : ref;
}

/** D1/SQLite reports unique index violations only in the error message. */
export function isUniqueViolation(err: unknown): boolean {
  for (let e = err as { message?: string; cause?: unknown } | undefined; e; e = e.cause as typeof e) {
    if (e.message?.includes('UNIQUE constraint failed')) return true;
  }
  return false;
}

/** Records a shipment and queues the label purchase. Returns the new shipment id. */
export async function requestShipment(input: ShipmentInput, userId: string | null): Promise<string> {
  const db = getDb();
  const order = await loadOrder(input.orderId);
  if (order.status === 'cancelled') throw new ShippingError(`Order ${order.externalNumber} is cancelled`);
  if (order.status === 'shipped' || order.status === 'delivered') throw new ShippingError(`Order ${order.externalNumber} is already shipped`);
  if (!order.readyToShip) throw new ShippingError(`Order ${order.externalNumber} is not ready to ship on ${order.marketplace} (${order.marketplaceStatus})`);

  const [carrier] = await withConfigured([await loadCarrierAccount(input.carrierAccountId)]);
  if (!carrier.enabled) throw new ShippingError(`${carrier.name} is disabled`);
  if (!carrier.configured) throw new ShippingError(`${carrier.name} has no working credentials. Check it in Settings → Integrations.`);
  if (!carrierSupportsOrder(carrier, order)) {
    throw new ShippingError(`${carrier.name} can only ship orders from its own Allegro account`);
  }
  if (!carrier.sender) throw new ShippingError(`${carrier.name} has no sender address. Add it in Settings → Integrations.`);

  const items = await db
    .select({ name: orderItems.name, quantity: orderItems.quantity })
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id))
    .orderBy(asc(orderItems.externalLineId));

  // Allegro's Packeta services (and any method it has refused before) need the parcel insured.
  const method = deliveryMethodOf(input.service, order);
  const insure =
    carrier.type === 'allegro_shipping' &&
    !input.options.insuranceAmount &&
    ((input.service === 'buyer_choice' && isPacketaMethod(order.deliveryMethodName)) || Boolean(method && carrier.settings.insuranceMethods?.includes(method)));

  let id: string;
  try {
    const [row] = await db
      .insert(shipments)
      .values({
        orderId: order.id,
        carrierAccountId: carrier.id,
        carrier: carrier.type,
        service: input.service,
        parcel: input.parcel,
        options: {
          reference: carrier.settings.productsInReference === false ? order.externalNumber : labelReference(order.externalNumber, items),
          ...input.options,
          ...(insure ? { insuranceAmount: declaredValue(order) } : {}),
        },
        labelFormat: input.labelFormat ?? carrier.settings.labelFormat ?? 'pdf',
        labelSize: input.labelSize ?? carrier.settings.labelSize ?? 'A6',
        batchId: input.batchId ?? null,
        createdBy: userId,
      })
      .returning({ id: shipments.id });
    id = row.id;
  } catch (err) {
    if (isUniqueViolation(err)) throw new ShippingError(`Order ${order.externalNumber} already has a label or one is being created`);
    throw err;
  }
  await logEvent(db, order.id, 'label', `Label requested: ${carrier.name}, ${input.service}`, { userId });
  await enqueue(JOBS.shipmentCreate, { shipmentId: id });
  return id;
}

async function findShipment(shipmentId: string): Promise<{ shipment: Shipment; order: Order; carrier: CarrierAccount } | null> {
  const db = getDb();
  const [row] = await db
    .select({ shipment: shipments, order: orders, carrier: carrierAccounts })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .innerJoin(carrierAccounts, eq(carrierAccounts.id, shipments.carrierAccountId))
    .where(eq(shipments.id, shipmentId));
  return row ?? null;
}

async function loadShipment(shipmentId: string) {
  const row = await findShipment(shipmentId);
  if (!row) throw new ShippingError('Shipment not found');
  return row;
}

async function failShipment(shipment: Shipment, error: string): Promise<void> {
  const db = getDb();
  await db.update(shipments).set({ state: 'failed', error }).where(eq(shipments.id, shipment.id));
  await logEvent(db, shipment.orderId, 'error', `Label failed: ${error}`);
  await retryWithInsurance(shipment, error);
}

/**
 * Allegro refused the label because the delivery service requires insurance: remember the method,
 * so the next label for it is insured from the start, and request this label once more insured.
 * (A new shipment is needed: Allegro keeps the result of the failed command.)
 */
async function retryWithInsurance(shipment: Shipment, error: string): Promise<void> {
  if (!isInsuranceRequiredError(error) || shipment.options.insuranceAmount) return;
  const row = await findShipment(shipment.id);
  if (!row || row.carrier.type !== 'allegro_shipping') return;
  const { order, carrier } = row;
  const db = getDb();
  const method = deliveryMethodOf(shipment.service, order);
  const known = carrier.settings.insuranceMethods ?? [];
  if (method && !known.includes(method)) {
    await db
      .update(carrierAccounts)
      .set({ settings: { ...carrier.settings, insuranceMethods: [...known, method] } })
      .where(eq(carrierAccounts.id, carrier.id));
  }
  try {
    await requestShipment(
      {
        orderId: order.id,
        carrierAccountId: carrier.id,
        service: shipment.service,
        parcel: shipment.parcel,
        options: { ...shipment.options, insuranceAmount: declaredValue(order) },
        labelFormat: shipment.labelFormat,
        labelSize: shipment.labelSize,
        batchId: shipment.batchId,
      },
      null,
    );
    await db.update(shipments).set({ error: `${error} (retried automatically with insurance)` }).where(eq(shipments.id, shipment.id));
    await logEvent(db, order.id, 'label', `Allegro requires insurance for this delivery method: label requested again with insurance ${declaredValue(order)} ${order.currency}`);
  } catch (err) {
    await logEvent(db, order.id, 'error', `Could not retry with insurance: ${err instanceof Error ? err.message : String(err)}`);
  }
}

/** Job: calls the carrier to create the shipment. */
export async function runCreateShipment(shipmentId: string): Promise<void> {
  const row = await findShipment(shipmentId);
  if (!row || row.shipment.state !== 'pending') return;
  const { shipment, order, carrier } = row;
  // Created before (e.g. the worker restarted mid-job): continue polling instead of buying again.
  if (shipment.externalId || shipment.commandId) return runPollShipment(shipmentId);

  let status: ShipmentStatus;
  try {
    const adapter = await getCarrierAdapter(carrier);
    status = await adapter.createShipment({
      shipmentId: shipment.id,
      service: shipment.service,
      sender: carrier.sender!,
      receiver: order.shippingAddress,
      pickupPointId: shipment.options.pickupPointId ?? order.pickupPointId,
      parcel: shipment.parcel,
      codAmount: shipment.options.codAmount ?? null,
      insuranceAmount: shipment.options.insuranceAmount ?? null,
      currency: order.currency,
      reference: shipment.options.reference ?? order.externalNumber,
      deliveryMethodId: order.deliveryMethodId,
      labelFormat: shipment.labelFormat,
    });
  } catch (err) {
    return failShipment(shipment, err instanceof Error ? err.message : String(err));
  }
  await applyStatus(shipment, carrier, status);
}

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Job: checks on a shipment the carrier is still creating, or retries the label
 * download for one that is created but has no file yet. Errors are saved on the
 * shipment so staff can see them, instead of disappearing inside the queue.
 */
export async function runPollShipment(shipmentId: string): Promise<void> {
  const row = await findShipment(shipmentId);
  if (!row) return;
  const { shipment, carrier } = row;
  if (shipment.state === 'created') {
    if (!(await getLabelRow(shipment.id))) await downloadLabel(shipment, carrier);
    return;
  }
  if (shipment.state !== 'pending') return;
  try {
    const adapter = await getCarrierAdapter(carrier);
    const status = await adapter.refreshShipment({ externalId: shipment.externalId, commandId: shipment.commandId });
    await applyStatus(shipment, carrier, status);
  } catch (err) {
    await recordPollError(shipment, errorText(err));
  }
}

async function recordPollError(shipment: Shipment, message: string): Promise<void> {
  const db = getDb();
  const attempts = shipment.pollAttempts + 1;
  if (attempts > MAX_POLLS) return failShipment(shipment, message);
  await db.update(shipments).set({ error: message, pollAttempts: attempts }).where(eq(shipments.id, shipment.id));
  if (message !== shipment.error) await logEvent(db, shipment.orderId, 'error', `Label check failed: ${message}`);
  await enqueue(JOBS.shipmentPoll, { shipmentId: shipment.id }, { startAfterSeconds: Math.min(300, 15 * attempts) });
}

async function applyStatus(shipment: Shipment, carrier: CarrierAccount, status: ShipmentStatus): Promise<void> {
  const db = getDb();
  if (status.state === 'failed') {
    await db
      .update(shipments)
      .set({ externalId: status.externalId || shipment.externalId, commandId: status.commandId ?? shipment.commandId })
      .where(eq(shipments.id, shipment.id));
    return failShipment(shipment, status.error ?? 'The carrier rejected the shipment');
  }

  if (status.state === 'pending') {
    const attempts = shipment.pollAttempts + 1;
    await db
      .update(shipments)
      .set({ externalId: status.externalId || shipment.externalId, commandId: status.commandId ?? shipment.commandId, pollAttempts: attempts })
      .where(eq(shipments.id, shipment.id));
    if (attempts > MAX_POLLS) {
      return failShipment(shipment, shipment.error ?? 'The carrier did not confirm the shipment in time');
    }
    await enqueue(JOBS.shipmentPoll, { shipmentId: shipment.id }, { startAfterSeconds: Math.max(1, Math.ceil(status.retryAfterSeconds ?? 3)) });
    return;
  }

  // Created: record the tracking number first, so a label-download problem never blocks the tracking push.
  await db.batch([
    db
      .update(shipments)
      .set({
        state: 'created',
        externalId: status.externalId,
        commandId: status.commandId ?? shipment.commandId,
        trackingNumber: status.trackingNumber ?? null,
        trackingUrl: status.trackingUrl ?? null,
        carrierCode: status.carrierCode ?? null,
        error: null,
      })
      .where(eq(shipments.id, shipment.id)),
    db.insert(orderEvents).values({ orderId: shipment.orderId, type: 'label', message: `Label created: ${carrier.name}, tracking ${status.trackingNumber ?? '—'}` }),
  ]);
  await changeStatus(db, shipment.orderId, 'label_created', { reason: 'label created', force: true });
  await enqueue(JOBS.trackingPush, { shipmentId: shipment.id });
  await downloadLabel({ ...shipment, externalId: status.externalId }, carrier);
}

async function getLabelRow(shipmentId: string) {
  const [row] = await getDb().select().from(labelFiles).where(eq(labelFiles.shipmentId, shipmentId));
  return row ?? null;
}

/** Fetches the label from the carrier into R2. Failures are saved on the shipment and retried by "Check now" or the sweep. */
async function downloadLabel(shipment: Shipment, carrier: CarrierAccount): Promise<void> {
  const db = getDb();
  try {
    const adapter = await getCarrierAdapter(carrier);
    const label = await adapter.getLabels([shipment.externalId!], { format: shipment.labelFormat, size: shipment.labelSize });
    const r2Key = `labels/${shipment.id}.${shipment.labelFormat}`;
    await getCfEnv().LABELS.put(r2Key, label, {
      httpMetadata: { contentType: shipment.labelFormat === 'pdf' ? 'application/pdf' : 'application/octet-stream' },
    });
    await db.batch([
      db
        .insert(labelFiles)
        .values({ shipmentId: shipment.id, format: shipment.labelFormat, size: shipment.labelSize, r2Key })
        .onConflictDoUpdate({ target: labelFiles.shipmentId, set: { r2Key } }),
      db.update(shipments).set({ error: null }).where(eq(shipments.id, shipment.id)),
    ]);
  } catch (err) {
    const message = `Label not downloaded yet: ${errorText(err)}`;
    await db.update(shipments).set({ error: message }).where(eq(shipments.id, shipment.id));
    if (message !== shipment.error) await logEvent(db, shipment.orderId, 'error', message);
  }
}

/**
 * Job: finds shipments stuck in "pending" (a poll job ran out of retries, or the
 * worker died mid-request) and polls them again.
 */
export async function runPendingSweep(): Promise<{ polled: number; failed: number }> {
  const db = getDb();
  const stale = await db
    .select()
    .from(shipments)
    .where(and(eq(shipments.state, 'pending'), lt(shipments.updatedAt, new Date(Date.now() - 2 * 60_000))));
  // Created labels whose file never arrived: retry the download.
  const missingFile = await db.all<{ id: string }>(sql`
    select s.id from shipments s left join label_files l on l.shipment_id = s.id
    where s.state = 'created' and l.shipment_id is null
      and s.updated_at < ${Date.now() - 2 * 60_000} and s.created_at > ${Date.now() - 24 * 3600_000}`);
  for (const { id } of missingFile) await enqueue(JOBS.shipmentPoll, { shipmentId: id });
  let polled = missingFile.length;
  let failed = 0;
  for (const shipment of stale) {
    if (shipment.externalId || shipment.commandId) {
      await db.update(shipments).set({ updatedAt: new Date() }).where(eq(shipments.id, shipment.id));
      await enqueue(JOBS.shipmentPoll, { shipmentId: shipment.id });
      polled++;
    } else if (shipment.createdAt.getTime() < Date.now() - 10 * 60_000) {
      // We never got an id back, so we can't tell whether the carrier created it.
      await failShipment(shipment, 'Label creation was interrupted. Check the carrier panel before retrying.');
      failed++;
    }
  }
  return { polled, failed };
}

/** Ticks or unticks "Packed" for a shipment. */
export async function setPacked(shipmentId: string, packed: boolean, userId: string): Promise<void> {
  const db = getDb();
  const [row] = await db
    .update(shipments)
    .set(packed ? { packedAt: new Date(), packedBy: userId } : { packedAt: null, packedBy: null })
    .where(eq(shipments.id, shipmentId))
    .returning({ orderId: shipments.orderId });
  if (!row) throw new ShippingError('Shipment not found');
  await logEvent(db, row.orderId, 'edit', packed ? 'Parcel marked as packed' : 'Parcel marked as not packed', { userId });
  if (packed) {
    await shipWhenReady(db, row.orderId, 'parcel packed and tracking sent', userId);
  } else {
    // Unticked by mistake: put the order back on the To do list.
    const [order] = await db.select({ status: orders.status }).from(orders).where(eq(orders.id, row.orderId));
    if (order?.status === 'shipped') await changeStatus(db, row.orderId, 'label_created', { reason: 'parcel not packed yet', userId, force: true });
  }
}

/** Manually re-checks a pending shipment. */
export async function pollNow(shipmentId: string): Promise<void> {
  await enqueue(JOBS.shipmentPoll, { shipmentId });
}

export async function cancelShipment(shipmentId: string, userId: string): Promise<void> {
  const db = getDb();
  const { shipment, order, carrier } = await loadShipment(shipmentId);
  if (shipment.state === 'cancelled') return;
  if (shipment.trackingPushedAt) {
    throw new ShippingError('Tracking was already sent to the marketplace; cancel the shipment there and in the carrier panel');
  }
  if (shipment.externalId && shipment.state === 'created') {
    await (await getCarrierAdapter(carrier)).cancelShipment(shipment.externalId);
  }
  await db.update(shipments).set({ state: 'cancelled' }).where(eq(shipments.id, shipment.id));
  await logEvent(db, order.id, 'label', `Label cancelled (${carrier.name})`, { userId });
  if (order.status === 'label_created') await changeStatus(db, order.id, 'processing', { userId, reason: 'label cancelled' });
}

/** Re-queues a failed shipment with the same settings. */
export async function retryShipment(shipmentId: string, userId: string): Promise<string> {
  const { shipment } = await loadShipment(shipmentId);
  if (shipment.state !== 'failed') throw new ShippingError('Only failed labels can be retried');
  return requestShipment(
    {
      orderId: shipment.orderId,
      carrierAccountId: shipment.carrierAccountId,
      service: shipment.service,
      parcel: shipment.parcel,
      options: shipment.options,
      labelFormat: shipment.labelFormat,
      labelSize: shipment.labelSize,
      batchId: shipment.batchId,
    },
    userId,
  );
}

async function readLabel(r2Key: string): Promise<Buffer | null> {
  const object = await getCfEnv().LABELS.get(r2Key);
  return object ? Buffer.from(await object.arrayBuffer()) : null;
}

export async function getLabel(shipmentId: string) {
  const [file] = await getDb().select().from(labelFiles).where(eq(labelFiles.shipmentId, shipmentId));
  if (!file) return null;
  const content = await readLabel(file.r2Key);
  return content ? { ...file, content } : null;
}

/** Joins labels into one printable file: PDFs are merged, ZPL is concatenated. */
export async function mergeLabels(files: { format: LabelFormat; content: Buffer }[]): Promise<{ format: LabelFormat; content: Buffer }> {
  if (files.length === 0) throw new ShippingError('No labels to print');
  const pdfs = files.filter((f) => f.format === 'pdf');
  if (pdfs.length === 0) return { format: 'zpl', content: Buffer.concat(files.map((f) => Buffer.concat([f.content, Buffer.from('\n')]))) };
  const merged = await PDFDocument.create();
  for (const file of pdfs) {
    const doc = await PDFDocument.load(file.content);
    for (const page of await merged.copyPages(doc, doc.getPageIndices())) merged.addPage(page);
  }
  return { format: 'pdf', content: Buffer.from(await merged.save()) };
}

export async function mergedLabelsFor(shipmentIds: string[]) {
  const rows = [];
  for (const ids of chunk(shipmentIds)) {
    rows.push(...(await getDb().select().from(labelFiles).where(inArray(labelFiles.shipmentId, ids))));
  }
  rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  const files = [];
  for (const row of rows) {
    const content = await readLabel(row.r2Key);
    if (content) files.push({ format: row.format, content });
  }
  return mergeLabels(files);
}

// ---------------------------------------------------------------- bulk

/**
 * Queues labels for many orders, each routed by the shipping rules.
 * Orders that can't be routed are listed in the batch as skipped.
 */
export async function createBatch(orderIds: string[], userId: string): Promise<string> {
  const db = getDb();
  const data = await loadRoutingData();
  const selected = [];
  for (const ids of chunk(orderIds)) selected.push(...(await db.select().from(orders).where(inArray(orders.id, ids))));
  const [batch] = await db.insert(shipmentBatches).values({ createdBy: userId, total: selected.length }).returning({ id: shipmentBatches.id });

  const skipped: { orderId: string; reason: string }[] = [];
  for (const selectedOrder of selected) {
    let order: Order;
    try {
      order = await withPickupPoint(selectedOrder);
    } catch (err) {
      skipped.push({ orderId: selectedOrder.id, reason: err instanceof Error ? err.message : String(err) });
      continue;
    }
    const route = routeOrder(order, data);
    if (!route) {
      skipped.push({ orderId: order.id, reason: 'No shipping rule with a working carrier matches this order' });
      continue;
    }
    const preset = data.presets.find((p) => p.id === route.packagePresetId) ?? data.presets.find((p) => p.isDefault) ?? data.presets[0];
    if (!preset) {
      skipped.push({ orderId: order.id, reason: 'No package preset defined' });
      continue;
    }
    try {
      await requestShipment(
        {
          orderId: order.id,
          carrierAccountId: route.carrierAccountId,
          service: route.service,
          parcel: presetToParcel(preset),
          options: { codAmount: order.codAmount, pickupPointId: order.pickupPointId },
          batchId: batch.id,
        },
        userId,
      );
    } catch (err) {
      skipped.push({ orderId: order.id, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  await db.update(shipmentBatches).set({ skipped }).where(eq(shipmentBatches.id, batch.id));
  return batch.id;
}

export async function getBatch(batchId: string) {
  const db = getDb();
  const [batch] = await db.select().from(shipmentBatches).where(eq(shipmentBatches.id, batchId));
  if (!batch) return null;
  const rows = await db
    .select({ shipment: shipments, order: orders, carrierName: carrierAccounts.name })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .innerJoin(carrierAccounts, eq(carrierAccounts.id, shipments.carrierAccountId))
    .where(eq(shipments.batchId, batchId))
    .orderBy(asc(orders.externalNumber));
  const skippedOrders = batch.skipped.length
    ? (await Promise.all(chunk(batch.skipped.map((s) => s.orderId)).map((ids) => db.select().from(orders).where(inArray(orders.id, ids))))).flat()
    : [];
  return { batch, rows, skipped: batch.skipped.map((s) => ({ ...s, order: skippedOrders.find((o) => o.id === s.orderId) ?? null })) };
}

export async function recentBatches(limit = 20) {
  return getDb().select().from(shipmentBatches).orderBy(desc(shipmentBatches.createdAt)).limit(limit);
}

export async function recentShipments(filter: { state?: string } = {}, limit = 100) {
  const db = getDb();
  return db
    .select({ shipment: shipments, order: orders, carrierName: carrierAccounts.name })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .innerJoin(carrierAccounts, eq(carrierAccounts.id, shipments.carrierAccountId))
    .where(filter.state ? and(eq(shipments.state, filter.state as Shipment['state'])) : undefined)
    .orderBy(desc(shipments.createdAt))
    .limit(limit);
}
