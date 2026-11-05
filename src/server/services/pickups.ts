// Courier pickups (Orders → Courier pickup): which labelled Allegro parcels still wait for a
// courier, the windows Allegro offers for them, and booking one pickup per Allegro account.
import { and, asc, count, desc, eq, gte, inArray, isNull, ne, or, sql } from 'drizzle-orm';
import { chunk, getDb } from '../db/client';
import {
  carrierAccounts,
  courierPickups,
  orders,
  pickupAddresses,
  shipments,
  type CourierPickup,
  type PickupAddress,
  type PickupAddressSnapshot,
} from '../db/schema';
import type { PickupSlot } from '../integrations/carriers/types';
import { enqueue, JOBS } from '../jobs/queue';
import { deliveryMethodOf } from '../integrations/carriers/allegro-shipping/insurance';
import { getCarrierAdapter } from './accounts';
import { logEvent } from './events';
import { msg } from '@/lib/i18n/msg';
import { commonSlots, dateOnlySlots, PICKUP_COURIERS, pickupCourierOf, pickupWindowStart, slotKey, type PickupCourier } from '@/lib/pickup-slots';
import { isDay, isTime, today } from '@/lib/tasks/dates';

/** Give up waiting for Allegro to confirm a pickup after this many checks. */
const MAX_POLLS = 40;

export class PickupError extends Error {}

export interface PickupParcel {
  shipmentId: string;
  orderId: string;
  orderNumber: string;
  buyer: string;
  marketplace: string;
  carrierAccountId: string;
  carrierName: string;
  packed: boolean;
  labelAt: Date;
  trackingNumber: string | null;
}

export interface PickupSummary extends CourierPickup {
  parcels: number;
}

export interface PickupColumn {
  courier: PickupCourier;
  parcels: PickupParcel[];
  pickups: PickupSummary[];
}

/** Labelled Allegro Delivery parcels that no booked (or booking) pickup covers yet. */
function waitingFilter() {
  return and(
    eq(shipments.state, 'created'),
    eq(shipments.carrier, 'allegro_shipping'),
    or(isNull(shipments.pickupId), eq(courierPickups.state, 'failed')),
    isNull(shipments.deliveredAt),
    isNull(shipments.pickupClearedAt),
    // Tracking that already shows the parcel at a point or delivered means it left with a courier.
    or(isNull(shipments.deliveryStatus), inArray(shipments.deliveryStatus, ['in_transit', 'unknown'])),
    ne(orders.status, 'cancelled'),
    eq(orders.historical, false),
    // Only labels from the previous working day and today: older parcels have already gone.
    gte(shipments.createdAt, pickupWindowStart(new Date())),
  );
}

async function waitingRows() {
  return getDb()
    .select({ shipment: shipments, order: orders, carrierName: carrierAccounts.name })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .innerJoin(carrierAccounts, eq(carrierAccounts.id, shipments.carrierAccountId))
    .leftJoin(courierPickups, eq(courierPickups.id, shipments.pickupId))
    .where(waitingFilter())
    .orderBy(asc(shipments.createdAt));
}

/** Packed parcels waiting for a courier, for the badge next to "Courier pickup". */
export async function pickupWaitingCount(): Promise<number> {
  const rows = await getDb()
    .select({ method: orders.deliveryMethodName, carrierCode: shipments.carrierCode })
    .from(shipments)
    .innerJoin(orders, eq(orders.id, shipments.orderId))
    .leftJoin(courierPickups, eq(courierPickups.id, shipments.pickupId))
    .where(and(waitingFilter(), sql`${shipments.packedAt} is not null`));
  return rows.filter((r) => pickupCourierOf(r.method, r.carrierCode)).length;
}

/** The Courier pickup page: one column per courier with its waiting parcels and recent pickups. */
export async function pickupBoard(now = new Date()): Promise<{ columns: PickupColumn[]; otherCouriers: number }> {
  const db = getDb();
  const [rows, recent] = await Promise.all([
    waitingRows(),
    db
      .select()
      .from(courierPickups)
      .where(or(gte(courierPickups.pickupDate, today(now)), gte(courierPickups.createdAt, new Date(now.getTime() - 86_400_000))))
      .orderBy(asc(courierPickups.pickupDate), desc(courierPickups.createdAt)),
  ]);
  const counts = recent.length
    ? await db
        .select({ pickupId: shipments.pickupId, n: count() })
        .from(shipments)
        .where(inArray(shipments.pickupId, recent.map((p) => p.id)))
        .groupBy(shipments.pickupId)
    : [];
  const parcelsPer = new Map(counts.map((c) => [c.pickupId, c.n]));

  const columns = new Map<PickupCourier, PickupColumn>(PICKUP_COURIERS.map((c) => [c, { courier: c, parcels: [], pickups: [] }]));
  let otherCouriers = 0;
  for (const { shipment, order, carrierName } of rows) {
    const courier = pickupCourierOf(order.deliveryMethodName, shipment.carrierCode);
    if (!courier) {
      otherCouriers++;
      continue;
    }
    columns.get(courier)!.parcels.push({
      shipmentId: shipment.id,
      orderId: order.id,
      orderNumber: order.externalNumber,
      buyer: order.shippingAddress.name || order.buyer.name,
      marketplace: order.marketplace,
      carrierAccountId: shipment.carrierAccountId,
      carrierName,
      packed: Boolean(shipment.packedAt),
      labelAt: shipment.createdAt,
      trackingNumber: shipment.trackingNumber,
    });
  }
  for (const pickup of recent) {
    const column = columns.get(pickup.courier as PickupCourier);
    if (column) column.pickups.push({ ...pickup, parcels: parcelsPer.get(pickup.id) ?? 0 });
  }
  return { columns: [...columns.values()], otherCouriers };
}

/** Loads the chosen parcels, checking each may still be booked. */
async function loadBookable(shipmentIds: string[]) {
  if (!shipmentIds.length) throw new PickupError(msg('Tick at least one parcel'));
  const rows = (await waitingRows()).filter((r) => shipmentIds.includes(r.shipment.id));
  if (rows.length !== new Set(shipmentIds).size) {
    throw new PickupError(msg('Some parcels already have a pickup or no longer need one. Refresh the page.'));
  }
  if (rows.some((r) => !r.shipment.packedAt)) throw new PickupError(msg('Only packed parcels can be booked for pickup'));
  if (rows.some((r) => !r.shipment.externalId)) throw new PickupError(msg('A parcel has no Allegro shipment id yet'));
  return rows;
}

async function loadCarrier(id: string) {
  const [carrier] = await getDb().select().from(carrierAccounts).where(eq(carrierAccounts.id, id));
  if (!carrier) throw new PickupError(msg('Carrier account not found'));
  return carrier;
}

function groupByCarrier<T extends { shipment: { carrierAccountId: string } }>(rows: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) groups.set(row.shipment.carrierAccountId, [...(groups.get(row.shipment.carrierAccountId) ?? []), row]);
  return groups;
}

/**
 * One pickup per Allegro account and delivery method: Allegro refuses a pickup that mixes delivery
 * networks (ORLEN Paczka and One Box) or integrations (two DPD services).
 */
function groupForPickup<T extends { shipment: { carrierAccountId: string; service: string }; order: { deliveryMethodId: string | null } }>(rows: T[]) {
  const groups = new Map<string, { carrierAccountId: string; rows: T[] }>();
  for (const row of rows) {
    const key = `${row.shipment.carrierAccountId}|${deliveryMethodOf(row.shipment.service, row.order) ?? ''}`;
    const group = groups.get(key) ?? { carrierAccountId: row.shipment.carrierAccountId, rows: [] };
    group.rows.push(row);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/**
 * Allegro's answer to a pickup it can't do in one go lists the shipments that belong together,
 * groups separated by "||" ("… Separate ids in different requests by ||: a, b || c"). Returns
 * those groups of shipment ids, or nothing when the message lists no such groups.
 */
export function splitGroupsFromError(text: string | null | undefined): string[][] {
  if (!text?.includes('||')) return [];
  // Allegro shipment ids are UUIDs; the demo carrier's start with "MOCK.".
  const uuid = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|MOCK\.[A-Za-z0-9_-]+/gi;
  return text
    .split('||')
    .map((part) => [...new Set(part.match(uuid) ?? [])])
    .filter((ids) => ids.length > 0);
}

export interface ProposalResult {
  slots: PickupSlot[];
  /** True when the carrier proposes no windows (InPost): the courier comes on the chosen day. */
  dateOnly: boolean;
  /** Parcels the courier won't collect (drop them off at a point instead). */
  unavailable: string[];
}

/** The pickup windows Allegro offers for all of the chosen parcels together. */
export async function pickupProposals(shipmentIds: string[], addressId: string, now = new Date()): Promise<ProposalResult> {
  const rows = await loadBookable(shipmentIds);
  const address = toSnapshot(await loadAddress(addressId));
  // InPost through Allegro proposes no windows: it is booked for a date and comes on its round.
  if (rows.every((r) => pickupCourierOf(r.order.deliveryMethodName, r.shipment.carrierCode) === 'InPost')) {
    return { slots: dateOnlySlots(now), dateOnly: true, unavailable: [] };
  }
  const offered = new Map<string, PickupSlot[]>();
  for (const [carrierAccountId, group] of groupByCarrier(rows)) {
    const adapter = await getCarrierAdapter(await loadCarrier(carrierAccountId));
    if (!adapter.pickupProposals) throw new PickupError(msg('This carrier account cannot book courier pickups'));
    const slots = await adapter.pickupProposals(
      group.map((r) => r.shipment.externalId!),
      address,
    );
    for (const r of group) offered.set(r.shipment.id, slots.get(r.shipment.externalId!) ?? []);
  }
  const unavailable = rows.filter((r) => !offered.get(r.shipment.id)!.length).map((r) => r.shipment.id);
  const withSlots = rows.filter((r) => offered.get(r.shipment.id)!.length).map((r) => offered.get(r.shipment.id)!);
  const shared = commonSlots(withSlots);
  if (shared.length || !withSlots.length) return { slots: shared, dateOnly: false, unavailable };
  // No window suits every parcel (different networks keep different hours): offer the earliest one's,
  // and leave the parcels that can't make it for another pickup.
  const first = commonSlots([withSlots.flat()])[0];
  const fits = (slots: PickupSlot[]) => slots.some((x) => slotKey(x) === slotKey(first));
  const later = rows.filter((r) => offered.get(r.shipment.id)!.length && !fits(offered.get(r.shipment.id)!)).map((r) => r.shipment.id);
  return { slots: commonSlots(withSlots.filter(fits)), dateOnly: false, unavailable: [...unavailable, ...later] };
}

function checkSlot(slot: PickupSlot): PickupSlot {
  if (!isDay(slot.date)) throw new PickupError(msg('Choose a pickup day'));
  if ((slot.minTime && !isTime(slot.minTime)) || (slot.maxTime && !isTime(slot.maxTime))) throw new PickupError(msg('Choose a pickup time'));
  return { date: slot.date, minTime: slot.minTime || null, maxTime: slot.maxTime || null };
}

/**
 * Books a pickup for the parcels: one per Allegro account (a pickup belongs to the account whose
 * labels it collects) and delivery method. The booking is confirmed in the background by `runPollPickup`.
 */
export async function bookPickup(
  input: { courier: PickupCourier; shipmentIds: string[]; addressId: string; slot: PickupSlot },
  userId: string,
): Promise<{ booked: number; failed: string[] }> {
  if (!(PICKUP_COURIERS as readonly string[]).includes(input.courier)) throw new PickupError(msg('Unknown courier'));
  const slot = checkSlot(input.slot);
  const rows = await loadBookable(input.shipmentIds);
  const saved = await loadAddress(input.addressId);
  const address = toSnapshot(saved);
  const db = getDb();
  const failed: string[] = [];
  let booked = 0;
  for (const { carrierAccountId, rows: group } of groupForPickup(rows)) {
    const pickupId = crypto.randomUUID();
    await db.batch([
      db.insert(courierPickups).values({
        id: pickupId,
        carrierAccountId,
        courier: input.courier,
        addressLabel: saved.label,
        address,
        pickupDate: slot.date,
        minTime: slot.minTime,
        maxTime: slot.maxTime,
        commandId: pickupId,
        createdBy: userId,
      }),
      ...chunk(group.map((r) => r.shipment.id), 90).map((ids) => db.update(shipments).set({ pickupId }).where(inArray(shipments.id, ids))),
    ]);
    const error = await sendPickup(pickupId, carrierAccountId, group.map((r) => r.shipment.externalId!), slot, address);
    if (error) failed.push(error);
    else booked++;
    const when = `${slot.date}${slot.minTime ? ` ${slot.minTime}–${slot.maxTime}` : ''}`;
    for (const r of group) await logEvent(db, r.order.id, 'label', `Courier pickup requested: ${input.courier}, ${when}`, { userId });
  }
  return { booked, failed };
}

/** Sends a pickup's create command and queues its confirmation; returns the error when Allegro refuses it at once. */
async function sendPickup(pickupId: string, carrierAccountId: string, externalIds: string[], slot: PickupSlot, address: PickupAddressSnapshot): Promise<string | null> {
  const adapter = await getCarrierAdapter(await loadCarrier(carrierAccountId));
  if (!adapter.createPickup) throw new PickupError(msg('This carrier account cannot book courier pickups'));
  try {
    const status = await adapter.createPickup(pickupId, externalIds, slot, address);
    await enqueue(JOBS.pickupPoll, { pickupId }, { startAfterSeconds: Math.max(1, Math.round(status.retryAfterSeconds ?? 2)) });
    return null;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    await getDb().update(courierPickups).set({ state: 'failed', error }).where(eq(courierPickups.id, pickupId));
    return error;
  }
}

/**
 * Allegro refused a pickup but named which shipments go together: books one pickup per group with
 * the same day, window and address, and drops the refused one. Each new pickup holds a single
 * group, so a second refusal can't split again.
 */
async function splitPickup(pickup: CourierPickup, groups: string[][]): Promise<boolean> {
  const db = getDb();
  const linked = await db.select({ id: shipments.id, externalId: shipments.externalId }).from(shipments).where(eq(shipments.pickupId, pickup.id));
  const byExternal = new Map(linked.map((s) => [s.externalId, s.id]));
  const parts = groups.map((ids) => ids.filter((id) => byExternal.has(id))).filter((ids) => ids.length > 0);
  if (parts.length < 2) return false;
  const slot = { date: pickup.pickupDate, minTime: pickup.minTime, maxTime: pickup.maxTime };
  const copy = {
    carrierAccountId: pickup.carrierAccountId,
    courier: pickup.courier,
    addressLabel: pickup.addressLabel,
    address: pickup.address,
    pickupDate: pickup.pickupDate,
    minTime: pickup.minTime,
    maxTime: pickup.maxTime,
    createdBy: pickup.createdBy,
  };
  for (const externalIds of parts) {
    const id = crypto.randomUUID();
    await db.batch([
      db.insert(courierPickups).values({ ...copy, id, commandId: id }),
      ...chunk(externalIds.map((e) => byExternal.get(e)!), 90).map((ids) => db.update(shipments).set({ pickupId: id }).where(inArray(shipments.id, ids))),
    ]);
    await sendPickup(id, pickup.carrierAccountId, externalIds, slot, pickup.address);
  }
  // Parcels Allegro didn't name stay with the refused pickup, so they return to the list.
  const left = await db.select({ n: count() }).from(shipments).where(eq(shipments.pickupId, pickup.id));
  if (left[0].n === 0) await db.delete(courierPickups).where(eq(courierPickups.id, pickup.id));
  else await db.update(courierPickups).set({ state: 'failed', error: msg('Allegro split this pickup; these parcels were not included. Book them again.') }).where(eq(courierPickups.id, pickup.id));
  return true;
}

/** Job: waits for Allegro to confirm a pickup, then stores the courier's pickup number. */
export async function runPollPickup(pickupId: string): Promise<void> {
  const db = getDb();
  const [pickup] = await db.select().from(courierPickups).where(eq(courierPickups.id, pickupId));
  if (!pickup || pickup.state !== 'pending' || !pickup.commandId) return;
  const attempts = pickup.pollAttempts + 1;
  try {
    const adapter = await getCarrierAdapter(await loadCarrier(pickup.carrierAccountId));
    const status = await adapter.pickupStatus!(pickup.commandId);
    if (status.state === 'booked') {
      await db
        .update(courierPickups)
        .set({ state: 'booked', externalId: status.pickupId ?? null, carrierPickupId: status.carrierPickupId ?? null, error: null, pollAttempts: attempts })
        .where(eq(courierPickups.id, pickupId));
      return;
    }
    if (status.state === 'failed') {
      if (await splitPickup(pickup, splitGroupsFromError(status.error))) return;
      await db.update(courierPickups).set({ state: 'failed', error: status.error ?? null, pollAttempts: attempts }).where(eq(courierPickups.id, pickupId));
      return;
    }
    if (attempts > MAX_POLLS) {
      await db
        .update(courierPickups)
        .set({ state: 'failed', error: msg('Allegro did not confirm the pickup in time. Check it in Allegro before booking again.'), pollAttempts: attempts })
        .where(eq(courierPickups.id, pickupId));
      return;
    }
    await db.update(courierPickups).set({ pollAttempts: attempts }).where(eq(courierPickups.id, pickupId));
    await enqueue(JOBS.pickupPoll, { pickupId }, { startAfterSeconds: Math.max(1, Math.round(status.retryAfterSeconds ?? 3)) });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (attempts > MAX_POLLS) {
      await db.update(courierPickups).set({ state: 'failed', error, pollAttempts: attempts }).where(eq(courierPickups.id, pickupId));
      return;
    }
    await db.update(courierPickups).set({ error, pollAttempts: attempts }).where(eq(courierPickups.id, pickupId));
    await enqueue(JOBS.pickupPoll, { pickupId }, { startAfterSeconds: Math.min(300, 15 * attempts) });
  }
}

/** Takes parcels that already left off the Courier pickup list. Nothing is booked or cancelled. */
export async function clearFromPickup(shipmentIds: string[]): Promise<number> {
  const ids = new Set(shipmentIds);
  const waiting = (await waitingRows()).filter((r) => ids.has(r.shipment.id)).map((r) => r.shipment.id);
  if (!waiting.length) return 0;
  const db = getDb();
  const now = new Date();
  for (const part of chunk(waiting, 90)) await db.update(shipments).set({ pickupClearedAt: now }).where(inArray(shipments.id, part));
  return waiting.length;
}

// ---------------------------------------------------------------- pickup addresses

export async function listPickupAddresses(): Promise<PickupAddress[]> {
  return getDb().select().from(pickupAddresses).orderBy(desc(pickupAddresses.isDefault), asc(pickupAddresses.label));
}

async function loadAddress(id: string): Promise<PickupAddress> {
  const [address] = await getDb().select().from(pickupAddresses).where(eq(pickupAddresses.id, id));
  if (!address) throw new PickupError(msg('Choose a pickup address'));
  return address;
}

function toSnapshot(a: PickupAddress): PickupAddressSnapshot {
  return {
    name: a.name,
    company: a.company,
    street: a.street,
    postalCode: a.postalCode,
    city: a.city,
    countryCode: a.countryCode,
    phone: a.phone,
    email: a.email,
  };
}

export type PickupAddressInput = Omit<PickupAddress, 'id' | 'createdAt'>;

/** The fields Allegro requires for a pickup address; the message names what is missing. */
export function validatePickupAddress(a: PickupAddressInput): string | null {
  if (!a.label.trim()) return msg('Give the address a name, e.g. "Warehouse"');
  if (!a.name?.trim() && !a.company?.trim()) return msg('Add a contact name or a company');
  if (!a.street.trim() || !a.postalCode.trim() || !a.city.trim()) return msg('Street, postal code and city are required');
  if (!/^[A-Z]{2}$/.test(a.countryCode.trim().toUpperCase())) return msg('Country must be a two-letter code, e.g. PL');
  if (a.phone.replace(/\D/g, '').length < 9) return msg('Add a phone number the courier can call');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(a.email.trim())) return msg('Add a valid email address');
  return null;
}

export async function savePickupAddress(input: PickupAddressInput, id?: string): Promise<void> {
  const error = validatePickupAddress(input);
  if (error) throw new PickupError(error);
  const db = getDb();
  const values = { ...input, countryCode: input.countryCode.trim().toUpperCase() };
  // The first address is the default, so booking always has one preselected.
  const [{ n }] = await db.select({ n: count() }).from(pickupAddresses);
  const isDefault = values.isDefault || n === 0 || (n === 1 && Boolean(id));
  const save = id
    ? db.update(pickupAddresses).set({ ...values, isDefault }).where(eq(pickupAddresses.id, id))
    : db.insert(pickupAddresses).values({ ...values, isDefault });
  if (isDefault) await db.batch([db.update(pickupAddresses).set({ isDefault: false }), save]);
  else await save;
}

export async function deletePickupAddress(id: string): Promise<void> {
  const db = getDb();
  const [removed] = await db.delete(pickupAddresses).where(eq(pickupAddresses.id, id)).returning();
  if (removed?.isDefault) {
    const [next] = await db.select().from(pickupAddresses).orderBy(asc(pickupAddresses.label)).limit(1);
    if (next) await db.update(pickupAddresses).set({ isDefault: true }).where(eq(pickupAddresses.id, next.id));
  }
}
