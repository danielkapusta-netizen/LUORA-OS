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

  it('books a pickup, takes its parcels off the list, and stores the courier number once confirmed', async () => {
    const [home] = await m.pickups.listPickupAddresses();
    const column = (await board()).columns.find((c) => c.parcels.some((p) => p.packed))!;
    const ids = column.parcels.filter((p) => p.packed).map((p) => p.shipmentId);
    const { slots } = await m.pickups.pickupProposals(ids, home.id);
    const before = await m.pickups.pickupWaitingCount();
    jobs.length = 0;

    expect(await m.pickups.bookPickup({ courier: column.courier, shipmentIds: ids, addressId: home.id, slot: slots[0] }, userId)).toEqual({ booked: 1, failed: [] });
    const after = await board();
    const same = after.columns.find((c) => c.courier === column.courier)!;
    expect(same.parcels.some((p) => ids.includes(p.shipmentId))).toBe(false);
    expect(same.pickups).toHaveLength(1);
    expect(same.pickups[0]).toMatchObject({ state: 'pending', parcels: ids.length, addressLabel: 'Magazyn', pickupDate: slots[0].date });
    expect(await m.pickups.pickupWaitingCount()).toBe(before - ids.length);
    // Booking the same parcels twice is refused.
    await expect(m.pickups.bookPickup({ courier: column.courier, shipmentIds: ids, addressId: home.id, slot: slots[0] }, userId)).rejects.toThrow(/already have a pickup/);

    const poll = jobs.find((j) => j.name === 'pickup-poll')!;
    await m.pickups.runPollPickup((poll.data as { pickupId: string }).pickupId);
    const [confirmed] = (await board()).columns.find((c) => c.courier === column.courier)!.pickups;
    expect(confirmed.state).toBe('booked');
    expect(confirmed.carrierPickupId).toMatch(/^MOCK-P\d{8}$/);
  });

  it('puts the parcels of a failed pickup back on the list', async () => {
    const [pickup] = await m.db.getDb().select().from(m.schema.courierPickups);
    await m.db.getDb().update(m.schema.courierPickups).set({ state: 'failed', error: 'Termin niedostępny' }).where(m.orm.eq(m.schema.courierPickups.id, pickup.id));
    const linked = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.pickupId, pickup.id));
    const back = (await parcels()).map((p) => p.shipmentId);
    expect(linked.every((s) => back.includes(s.id))).toBe(true);
  });
});
