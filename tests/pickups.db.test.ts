// Courier pickups against a local D1 database in demo mode: which parcels wait, pickup addresses,
// proposals, booking one pickup, and its confirmation.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('courier pickups (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-pickups-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    shipping: typeof import('@/server/services/shipping');
    pickups: typeof import('@/server/services/pickups');
  };
  let userId: string;
  const labelled: string[] = [];
  const jobs: { name: string; data: unknown }[] = [];

  const address = {
    label: 'Magazyn',
    name: 'Daniel',
    company: 'Luora',
    street: 'ul. Magazynowa 5',
    postalCode: '02-222',
    city: 'Warszawa',
    countryCode: 'pl',
    phone: '500 600 700',
    email: 'magazyn@example.com',
    isDefault: false,
  };

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    (await import('@/server/jobs/queue')).setEnqueueImplementation(async (name, data) => void jobs.push({ name, data }));
    await (await import('@/server/db/seed')).seed();
    m = {
      db: await import('@/server/db/client'),
      schema: await import('@/server/db/schema'),
      orm: await import('drizzle-orm'),
      shipping: await import('@/server/services/shipping'),
      pickups: await import('@/server/services/pickups'),
    };
    const orders = await import('@/server/services/orders');
    for (const a of await m.db.getDb().select().from(m.schema.marketplaceAccounts)) await orders.syncAccount(a.id);
    userId = (await m.db.getDb().select().from(m.schema.users))[0].id;

    // Labels for the Allegro orders (Allegro Delivery) and one Shopify order (InPost, not bookable here).
    const data = await m.shipping.loadRoutingData();
    const all = await m.db.getDb().select().from(m.schema.orders);
    const allegro = all.filter((o) => o.marketplace === 'allegro' && o.readyToShip && o.status === 'new');
    const shopify = all.find((o) => o.marketplace === 'shopify' && o.readyToShip && o.status === 'new')!;
    for (const order of [...allegro, shopify]) {
      const route = m.shipping.routeOrder(order, data)!;
      const id = await m.shipping.requestShipment(
        { orderId: order.id, carrierAccountId: route.carrierAccountId, service: route.service, parcel: m.shipping.presetToParcel(data.presets[0]), options: {} },
        userId,
      );
      await m.shipping.runCreateShipment(id);
      await m.shipping.runPollShipment(id);
      if (order.marketplace === 'allegro') labelled.push(id);
    }
    // Every Allegro parcel but the last is packed.
    for (const id of labelled.slice(0, -1)) await m.shipping.setPacked(id, true, userId);
  }, 180_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  const board = () => m.pickups.pickupBoard();
  const parcels = async () => (await board()).columns.flatMap((c) => c.parcels.map((p) => ({ ...p, courier: c.courier })));

  it('lists labelled Allegro parcels by courier, packed ones bookable, others waiting', async () => {
    const list = await parcels();
    const { otherCouriers } = await board();
    // Every Allegro label is either in a courier column or counted as another courier (Allegro One).
    expect(list.length + otherCouriers).toBe(labelled.length);
    expect(list.every((p) => labelled.includes(p.shipmentId))).toBe(true);
    const unpacked = list.filter((p) => !p.packed).map((p) => p.shipmentId);
    expect(unpacked.every((id) => id === labelled.at(-1))).toBe(true);
    // The Shopify parcel (InPost directly) is not here, and the badge counts packed parcels only.
    expect(await m.pickups.pickupWaitingCount()).toBe(list.filter((p) => p.packed).length);
  });

  it('checks a pickup address and makes the first one the default', async () => {
    await expect(m.pickups.savePickupAddress({ ...address, email: 'not-an-email' })).rejects.toThrow('valid email');
    await expect(m.pickups.savePickupAddress({ ...address, name: null, company: null })).rejects.toThrow('contact name or a company');
    await m.pickups.savePickupAddress(address);
    await m.pickups.savePickupAddress({ ...address, label: 'Biuro', street: 'ul. Biurowa 1' });
    const saved = await m.pickups.listPickupAddresses();
    expect(saved.map((a) => [a.label, a.isDefault])).toEqual([
      ['Magazyn', true],
      ['Biuro', false],
    ]);
    expect(saved[0].countryCode).toBe('PL');
  });

  it('offers windows for a courier, and date-only days for InPost', async () => {
    const [home] = await m.pickups.listPickupAddresses();
    const list = (await parcels()).filter((p) => p.packed);
    const courier = list.find((p) => p.courier !== 'InPost');
    if (courier) {
      const result = await m.pickups.pickupProposals([courier.shipmentId], home.id);
      expect(result.dateOnly).toBe(false);
      expect(result.slots.length).toBe(4);
      expect(result.slots[0]).toMatchObject({ minTime: '09:00', maxTime: '12:00' });
    }
    const inpost = list.find((p) => p.courier === 'InPost');
    if (inpost) {
      const result = await m.pickups.pickupProposals([inpost.shipmentId], home.id);
      expect(result.dateOnly).toBe(true);
      expect(result.slots.every((s) => !s.minTime)).toBe(true);
    }
    expect(courier ?? inpost).toBeTruthy();
    // Unpacked parcels can't be booked.
    await expect(m.pickups.pickupProposals([labelled.at(-1)!], home.id)).rejects.toThrow(/packed|no longer need/);
  });

  const methodsOf = async (shipmentIds: string[]) =>
    new Map(
      (
        await m.db
          .getDb()
          .select({ id: m.schema.shipments.id, externalId: m.schema.shipments.externalId, method: m.schema.orders.deliveryMethodId })
          .from(m.schema.shipments)
          .innerJoin(m.schema.orders, m.orm.eq(m.schema.orders.id, m.schema.shipments.orderId))
          .where(m.orm.inArray(m.schema.shipments.id, shipmentIds))
      ).map((r) => [r.id, r]),
    );
  const pollAll = async () => {
    const pending = jobs.filter((j) => j.name === 'pickup-poll').map((j) => (j.data as { pickupId: string }).pickupId);
    jobs.length = 0;
    for (const id of pending) await m.pickups.runPollPickup(id);
  };

  it('books one pickup per delivery method, takes the parcels off the list, and stores the courier numbers', async () => {
    const [home] = await m.pickups.listPickupAddresses();
    // The busiest column, so it mixes delivery methods where the demo data has them (DPD and DPD COD).
    const column = (await board()).columns.filter((c) => c.courier !== 'InPost').sort((a, b) => b.parcels.filter((p) => p.packed).length - a.parcels.filter((p) => p.packed).length)[0];
    const ids = column.parcels.filter((p) => p.packed).map((p) => p.shipmentId);
    const methods = new Set([...(await methodsOf(ids)).values()].map((r) => r.method));
    const { slots } = await m.pickups.pickupProposals(ids, home.id);
    const before = await m.pickups.pickupWaitingCount();
    jobs.length = 0;

    expect(await m.pickups.bookPickup({ courier: column.courier, shipmentIds: ids, addressId: home.id, slot: slots[0] }, userId)).toEqual({ booked: methods.size, failed: [] });
    const same = (await board()).columns.find((c) => c.courier === column.courier)!;
    expect(same.parcels.some((p) => ids.includes(p.shipmentId))).toBe(false);
    expect(same.pickups).toHaveLength(methods.size);
    expect(same.pickups.reduce((n, p) => n + p.parcels, 0)).toBe(ids.length);
    expect(same.pickups.every((p) => p.state === 'pending' && p.addressLabel === 'Magazyn' && p.pickupDate === slots[0].date)).toBe(true);
    expect(await m.pickups.pickupWaitingCount()).toBe(before - ids.length);
    // Booking the same parcels twice is refused.
    await expect(m.pickups.bookPickup({ courier: column.courier, shipmentIds: ids, addressId: home.id, slot: slots[0] }, userId)).rejects.toThrow(/already have a pickup/);

    await pollAll();
    const confirmed = (await board()).columns.find((c) => c.courier === column.courier)!.pickups;
    expect(confirmed.every((p) => p.state === 'booked' && /^MOCK-P\d{8}$/.test(p.carrierPickupId ?? ''))).toBe(true);
  });

  it('offers InPost by date only, without asking Allegro for windows', async () => {
    const [home] = await m.pickups.listPickupAddresses();
    const inpost = (await board()).columns.find((c) => c.courier === 'InPost')!.parcels.filter((p) => p.packed);
    if (!inpost.length) return;
    const result = await m.pickups.pickupProposals(inpost.map((p) => p.shipmentId), home.id);
    expect(result).toMatchObject({ dateOnly: true, unavailable: [] });
    expect(result.slots.every((s) => !s.minTime && !s.maxTime)).toBe(true);
  });

  it('puts the parcels of a failed pickup back on the list', async () => {
    const [pickup] = await m.db.getDb().select().from(m.schema.courierPickups);
    await m.db.getDb().update(m.schema.courierPickups).set({ state: 'failed', error: 'Termin niedostępny' }).where(m.orm.eq(m.schema.courierPickups.id, pickup.id));
    const linked = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.pickupId, pickup.id));
    const back = (await parcels()).map((p) => p.shipmentId);
    expect(linked.every((s) => back.includes(s.id))).toBe(true);
  });

  it('splits a pickup Allegro refuses for mixing integrations, as Allegro’s message says', async () => {
    const db = m.db.getDb();
    // Free every parcel again, then take two packed ones with different delivery methods.
    await db.update(m.schema.shipments).set({ pickupId: null });
    const waiting = (await parcels()).filter((p) => p.packed).map((p) => p.shipmentId);
    const info = await methodsOf(waiting);
    const byMethod = new Map<string | null, string>();
    for (const r of info.values()) if (!byMethod.has(r.method)) byMethod.set(r.method, r.id);
    const pair = [...byMethod.values()].slice(0, 2);
    expect(pair).toHaveLength(2);

    const carrier = (await db.select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.id, pair[0])))[0].carrierAccountId;
    const address = { street: 'ul. Magazynowa 5', postalCode: '02-222', city: 'Warszawa', countryCode: 'PL', phone: '500600700', email: 'm@example.com', company: 'Luora' };
    const id = crypto.randomUUID();
    await db.insert(m.schema.courierPickups).values({ id, carrierAccountId: carrier, courier: 'DPD', addressLabel: 'Magazyn', address, pickupDate: '2026-11-03', minTime: '09:00', maxTime: '12:00', commandId: id });
    await db.update(m.schema.shipments).set({ pickupId: id }).where(m.orm.inArray(m.schema.shipments.id, pair));
    const { getCarrierAdapter } = await import('@/server/services/accounts');
    const [account] = await db.select().from(m.schema.carrierAccounts).where(m.orm.eq(m.schema.carrierAccounts.id, carrier));
    await (await getCarrierAdapter(account)).createPickup!(id, pair.map((s) => info.get(s)!.externalId!), { date: '2026-11-03', minTime: '09:00', maxTime: '12:00' }, address);

    jobs.length = 0;
    await m.pickups.runPollPickup(id);
    // The refused pickup is gone; each parcel has its own, booked once confirmed.
    expect(await db.select().from(m.schema.courierPickups).where(m.orm.eq(m.schema.courierPickups.id, id))).toHaveLength(0);
    const linked = await db.select().from(m.schema.shipments).where(m.orm.inArray(m.schema.shipments.id, pair));
    expect(new Set(linked.map((s) => s.pickupId)).size).toBe(2);
    await pollAll();
    const split = await db.select().from(m.schema.courierPickups).where(m.orm.inArray(m.schema.courierPickups.id, linked.map((s) => s.pickupId!)));
    expect(split.map((p) => [p.state, p.pickupDate, p.minTime])).toEqual([
      ['booked', '2026-11-03', '09:00'],
      ['booked', '2026-11-03', '09:00'],
    ]);
  });
});
