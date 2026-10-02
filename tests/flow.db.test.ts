// Full order → label → tracking → stock flow against a local D1 database and
// R2 bucket (wrangler's simulators), using the mock marketplaces and carriers.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('order flow (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-d1-'));
  let dispose: (() => Promise<void>) | undefined;
  type Queued = { name: string; data: unknown };
  const queue: Queued[] = [];
  // Loaded after the environment is pointed at the test database.
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    orders: typeof import('@/server/services/orders');
    shipping: typeof import('@/server/services/shipping');
    inventory: typeof import('@/server/services/inventory');
    workflow: typeof import('@/server/services/workflow');
    analytics: typeof import('@/server/services/analytics');
    handlers: typeof import('@/server/jobs/handlers');
  };

  /** Runs queued jobs (and the jobs they queue) until nothing is left. */
  async function drain(skip: string[] = []) {
    for (let i = 0; i < 200 && queue.some((j) => !skip.includes(j.name)); i++) {
      const index = queue.findIndex((j) => !skip.includes(j.name));
      const [job] = queue.splice(index, 1);
      await m.handlers.runJob(job.name as never, job.data as never);
    }
  }

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    const db = await import('@/server/db/client');
    const orm = await import('drizzle-orm');
    const queueModule = await import('@/server/jobs/queue');
    queueModule.setEnqueueImplementation(async (name, data) => void queue.push({ name, data }));
    const { seed } = await import('@/server/db/seed');
    await seed();
    m = {
      db,
      orm,
      schema: await import('@/server/db/schema'),
      orders: await import('@/server/services/orders'),
      shipping: await import('@/server/services/shipping'),
      inventory: await import('@/server/services/inventory'),
      workflow: await import('@/server/services/workflow'),
      analytics: await import('@/server/services/analytics'),
      handlers: await import('@/server/jobs/handlers'),
    };
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  const allOrders = () => m.db.getDb().select().from(m.schema.orders);
  const productStock = async () =>
    Object.fromEntries((await m.db.getDb().select().from(m.schema.products)).map((p) => [p.sku, p.stock]));
  const adminId = async () => (await m.db.getDb().select().from(m.schema.users))[0].id;

  it('imports orders from every marketplace and takes stock', async () => {
    const before = await productStock();
    const accounts = await m.db.getDb().select().from(m.schema.marketplaceAccounts);
    for (const a of accounts) await m.orders.syncAccount(a.id);
    // A second sync must not duplicate anything.
    for (const a of accounts) await m.orders.syncAccount(a.id);

    const rows = await allOrders();
    expect(new Set(rows.map((o) => o.marketplace))).toEqual(new Set(['shopify', 'allegro', 'empik']));
    expect(rows.length).toBeGreaterThanOrEqual(42);

    const items = await m.db.getDb().select().from(m.schema.orderItems);
    const sold: Record<string, number> = {};
    for (const i of items) sold[i.sku!] = (sold[i.sku!] ?? 0) + i.quantity;
    const after = await productStock();
    for (const sku of Object.keys(before)) expect(after[sku]).toBe(before[sku] - (sold[sku] ?? 0));
    expect(queue.some((j) => j.name === 'stock-push')).toBe(true);
    queue.length = 0;
  });

  it('routes, buys a locker label, pushes tracking and marks the order shipped', async () => {
    const order = (await allOrders()).find((o) => o.marketplace === 'shopify' && o.pickupPointId)!;
    const form = await m.shipping.shippingFormData(order.id);
    expect(form.route?.service).toBe('inpost_locker_standard');

    const id = await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} },
      await adminId(),
    );
    await expect(
      m.shipping.requestShipment({ orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} }, null),
    ).rejects.toThrow(/already has a label/);

    await drain();
    const [shipment] = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.id, id));
    expect(shipment).toMatchObject({ state: 'created', carrierCode: 'INPOST' });
    expect(shipment.trackingNumber).toMatch(/^6\d{23}$/);
    expect(shipment.trackingPushedAt).not.toBeNull();
    expect(await m.shipping.getLabel(id)).toMatchObject({ format: 'pdf' });
    const readOrder = async () => (await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, order.id)))[0];
    // Tracking is on the marketplace, but the order stays on To do until the parcel is packed.
    expect((await readOrder()).status).toBe('label_created');
    // A marketplace sync reporting it shipped (our own tracking push) doesn't skip packing either.
    const accounts = await import('@/server/services/accounts');
    const account = await accounts.loadMarketplaceAccount(order.accountId);
    const fresh = (await accounts.getMarketplaceAdapter(account).getOrder(order.externalId))!;
    await m.orders.upsertOrders(account, [{ ...fresh, fulfilled: true }]);
    expect((await readOrder()).status).toBe('label_created');

    await m.shipping.setPacked(id, true, await adminId());
    const updated = await readOrder();
    expect(updated.status).toBe('shipped');
    expect(updated.shippedAt).not.toBeNull();
  });

  it('marks a parcel as packed and back, logging it on the order', async () => {
    const [shipment] = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.state, 'created')).limit(1);
    const read = async () => (await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.id, shipment.id)))[0];
    const orderStatus = async () => (await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, shipment.orderId)))[0].status;
    const userId = await adminId();
    expect(shipment.packedAt).toBeInstanceOf(Date);
    // Unticking puts a shipped order back on the To do list.
    await m.shipping.setPacked(shipment.id, false, userId);
    expect(await read()).toMatchObject({ packedAt: null, packedBy: null });
    expect(await orderStatus()).toBe('label_created');
    await m.shipping.setPacked(shipment.id, true, userId);
    expect(await read()).toMatchObject({ packedBy: userId });
    expect((await read()).packedAt).toBeInstanceOf(Date);
    expect(await orderStatus()).toBe('shipped');
    const events = await m.db.getDb().select().from(m.schema.orderEvents).where(m.orm.eq(m.schema.orderEvents.orderId, shipment.orderId));
    expect(events.map((e) => e.message)).toEqual(expect.arrayContaining(['Parcel marked as packed', 'Parcel marked as not packed']));
    await expect(m.shipping.setPacked('missing', true, userId)).rejects.toThrow('Shipment not found');
  });

  it('cancels a label before tracking is sent and reopens the order', async () => {
    const order = (await allOrders()).find((o) => o.marketplace === 'shopify' && !o.pickupPointId && o.status === 'new')!;
    const data = await m.shipping.loadRoutingData();
    const route = m.shipping.routeOrder(order, data)!;
    expect(route.service).toBe('inpost_courier_standard');
    const id = await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: route.carrierAccountId, service: route.service, parcel: m.shipping.presetToParcel(data.presets[0]), options: {} },
      null,
    );
    await drain(['tracking-push']);
    queue.length = 0;
    await m.shipping.cancelShipment(id, await adminId());
    const [reopened] = await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, order.id));
    expect(reopened.status).toBe('processing');
    // With the old label cancelled a new one may be bought.
    await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: route.carrierAccountId, service: route.service, parcel: m.shipping.presetToParcel(data.presets[0]), options: {} },
      null,
    );
    queue.length = 0;
  });

  it('returns stock when an order is cancelled and takes it again when reopened', async () => {
    const order = (await allOrders()).find((o) => o.marketplace === 'allegro' && o.status === 'new')!;
    const items = await m.db.getDb().select().from(m.schema.orderItems).where(m.orm.eq(m.schema.orderItems.orderId, order.id));
    const before = await productStock();
    await m.workflow.changeStatus(m.db.getDb(), order.id, 'cancelled', {});
    const cancelled = await productStock();
    for (const i of items) expect(cancelled[i.sku!]).toBe(before[i.sku!] + items.filter((x) => x.sku === i.sku).reduce((s, x) => s + x.quantity, 0));
    await m.workflow.changeStatus(m.db.getDb(), order.id, 'new', {});
    expect(await productStock()).toEqual(before);
    await expect(m.workflow.changeStatus(m.db.getDb(), order.id, 'delivered', {})).rejects.toThrow(/Can't move/);
    queue.length = 0;
  });

  it('creates a bulk batch, skipping orders that are not ready', async () => {
    const rows = await allOrders();
    const allegro = rows.filter((o) => o.marketplace === 'allegro' && o.status === 'new').slice(0, 3);
    const waiting = rows.find((o) => o.marketplace === 'empik' && !o.readyToShip)!;
    const batchId = await m.shipping.createBatch([...allegro.map((o) => o.id), waiting.id], await adminId());
    await drain();
    const batch = (await m.shipping.getBatch(batchId))!;
    expect(batch.rows.map((r) => r.shipment.state)).toEqual(['created', 'created', 'created']);
    expect(batch.rows.every((r) => r.shipment.carrier === 'allegro_shipping')).toBe(true);
    expect(batch.skipped).toHaveLength(1);
    expect(batch.skipped[0].reason).toMatch(/not ready to ship/);
    const merged = await m.shipping.mergedLabelsFor(batch.rows.map((r) => r.shipment.id));
    expect(merged.format).toBe('pdf');
  });

  it('accepts an Empik order, which then becomes shippable', async () => {
    const waiting = (await allOrders()).find((o) => o.marketplace === 'empik' && o.marketplaceStatus === 'WAITING_ACCEPTANCE')!;
    await m.orders.acceptOrder(waiting.id, await adminId());
    const [after] = await m.db.getDb().select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.id, waiting.id));
    expect(after).toMatchObject({ readyToShip: true, marketplaceStatus: 'SHIPPING' });
  });

  it('pushes master stock to listings, only logging in dry-run mode', async () => {
    const [account] = await m.db.getDb().select().from(m.schema.marketplaceAccounts).where(m.orm.eq(m.schema.marketplaceAccounts.type, 'shopify'));
    const dry = await m.inventory.runStockPush(account.id);
    expect(dry).toMatchObject({ dryRun: true });
    expect((await m.inventory.runStockPush(account.id)).pushed).toBe(0);

    await m.db.getDb().update(m.schema.marketplaceAccounts).set({ stockDryRun: false }).where(m.orm.eq(m.schema.marketplaceAccounts.id, account.id));
    const live = await m.inventory.runStockPush(account.id);
    expect(live).toEqual({ pushed: 6, dryRun: false });
    expect((await m.inventory.runStockPush(account.id)).pushed).toBe(0);
  });

  it('reports analytics over the stored orders', async () => {
    const data = await m.analytics.analytics({ from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 60_000) });
    expect(data.kpis.orders).toBeGreaterThan(30);
    expect(data.byMarketplace).toHaveLength(3);
    expect(data.carriers.length).toBeGreaterThan(0);
  });

  it('keeps the tracking number when the label download fails, and fetches the file on "Check now"', async () => {
    const { MockCarrierAdapter } = await import('@/server/integrations/carriers/mock/adapter');
    const order = (await allOrders()).find((o) => o.marketplace === 'shopify' && o.status === 'new' && o.pickupPointId)!;
    const form = await m.shipping.shippingFormData(order.id);
    const original = MockCarrierAdapter.prototype.getLabels;
    MockCarrierAdapter.prototype.getLabels = async () => {
      throw new Error('label endpoint unavailable');
    };
    let id: string;
    try {
      id = await m.shipping.requestShipment(
        { orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} },
        null,
      );
      await drain(['tracking-push']);
    } finally {
      MockCarrierAdapter.prototype.getLabels = original;
    }
    const [shipment] = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.id, id));
    expect(shipment.state).toBe('created');
    expect(shipment.trackingNumber).toBeTruthy();
    expect(shipment.error).toMatch(/Label not downloaded yet: label endpoint unavailable/);
    expect(await m.shipping.getLabel(id)).toBeNull();

    queue.length = 0;
    await m.shipping.pollNow(id);
    await drain(['tracking-push']);
    expect(await m.shipping.getLabel(id)).toMatchObject({ format: 'pdf' });
    const [fixed] = await m.db.getDb().select().from(m.schema.shipments).where(m.orm.eq(m.schema.shipments.id, id));
    expect(fixed.error).toBeNull();
    queue.length = 0;
  });

  it('issues the invoice a buyer asked for once the order ships, attaches it and sends it to KSeF', async () => {
    const invoicing = await import('@/server/services/invoicing');
    const db = m.db.getDb();
    const userId = await adminId();
    await invoicing.saveAccounting({
      enabled: true,
      login: '',
      invoiceKey: null,
      settings: { autoOnShipped: true, uploadAllegro: true, uploadEmpik: true, sendB2bToKsef: true, defaultVatRate: 0.23 },
    });
    const candidates = (await allOrders()).filter((o) => o.marketplace === 'allegro' && o.readyToShip && o.status === 'new' && !o.codAmount);
    const order = candidates[0];
    const other = candidates[1];
    await db
      .update(m.schema.orders)
      .set({ invoiceRequest: { name: 'Kosmetyki Sp. z o.o.', taxId: '5250001009', euPrefix: null, street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' } })
      .where(m.orm.eq(m.schema.orders.id, order.id));
    await expect(invoicing.requestInvoice(other.id, userId)).rejects.toThrow('did not ask for an invoice');

    const form = await m.shipping.shippingFormData(order.id);
    const shipmentId = await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} },
      userId,
    );
    await drain();
    expect(await invoicing.invoicesForOrder(order.id)).toHaveLength(0); // not shipped until packed
    await m.shipping.setPacked(shipmentId, true, userId);
    await drain();

    const [invoice] = await invoicing.invoicesForOrder(order.id);
    expect(invoice).toMatchObject({ state: 'issued', kind: 'domestic', grossAmount: order.totalAmount, error: null, uploadError: null, ksefError: null });
    expect(invoice.number).toMatch(/MOCK/);
    expect(invoice.uploadedAt).toBeInstanceOf(Date);
    expect(invoice.ksefSentAt).toBeInstanceOf(Date);
    expect((await invoicing.getInvoicePdf(invoice.id))?.content.subarray(0, 4).toString()).toBe('%PDF');
    await expect(invoicing.requestInvoice(order.id, userId)).rejects.toThrow('already has an invoice');
    const awaiting = await invoicing.ordersAwaitingInvoice();
    expect(awaiting.map((r) => r.order.id)).not.toContain(order.id);
  });

  it('removes demo accounts with their orders, labels and rules', async () => {
    const settings = await import('@/server/services/settings');
    expect(await settings.demoAccountCount()).toBe(5);
    const labelKeys = (await m.db.getDb().select().from(m.schema.labelFiles)).map((l) => l.r2Key);
    expect(labelKeys.length).toBeGreaterThan(0);

    const removed = await settings.removeDemoData();
    expect(removed).toMatchObject({ accounts: 3, carriers: 2 });
    expect(await settings.demoAccountCount()).toBe(0);
    expect(await allOrders()).toHaveLength(0);
    expect(await m.db.getDb().select().from(m.schema.shippingRules)).toHaveLength(0);
    expect(await m.db.getDb().select().from(m.schema.products)).toHaveLength(0);
    const { getCfEnv } = await import('@/server/cf');
    for (const key of labelKeys) expect(await getCfEnv().LABELS.get(key)).toBeNull();
  });
});
