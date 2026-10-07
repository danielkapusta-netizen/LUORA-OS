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
  /** Orders an earlier test gave an extra line, so their total no longer matches their items. */
  const alteredOrders = async () =>
    new Set(
      (
        await m.db
          .getDb()
          .select({ orderId: m.schema.orderItems.orderId })
          .from(m.schema.orderItems)
          .where(m.orm.eq(m.schema.orderItems.externalLineId, 'night-1'))
      ).map((r) => r.orderId),
    );

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

  it('sends a fixed quantity, or nothing, to a listing, and skips listings that are off sale', async () => {
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const [empik] = await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, 'empik'));
    await db.update(s.marketplaceAccounts).set({ stockSyncEnabled: true, stockDryRun: false }).where(orm.eq(s.marketplaceAccounts.id, empik.id));
    await m.inventory.runStockPush(empik.id, { force: true });
    const listings = await db.select().from(s.productListings).where(orm.eq(s.productListings.accountId, empik.id));
    const [fixed, off, inactive] = listings;

    await m.inventory.setListingStock(fixed.id, 'fixed', 3);
    await m.inventory.setListingStock(off.id, 'off');
    await db.update(s.productListings).set({ active: false, lastPushedQty: null, lastSeenQty: 0 }).where(orm.eq(s.productListings.id, inactive.id));
    await db.update(s.productListings).set({ lastPushedQty: null }).where(orm.inArray(s.productListings.id, [off.id]));

    const result = await m.inventory.runStockPush(empik.id);
    expect(result.dryRun).toBe(false);
    const rows = await db.select().from(s.productListings).where(orm.eq(s.productListings.accountId, empik.id));
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(fixed.id)!.lastPushedQty).toBe(3);
    expect(byId.get(off.id)!.lastPushedQty).toBeNull();
    expect(byId.get(inactive.id)!.lastPushedQty).toBeNull();
    await expect(m.inventory.setListingStock(fixed.id, 'fixed', -1)).rejects.toThrow(/whole number/);
    // Leave the account as the demo data has it, for the tests that follow.
    await db
      .update(s.productListings)
      .set({ stockMode: 'master', fixedQty: null, active: true, lastPushedQty: null, lastPushedAt: null })
      .where(orm.eq(s.productListings.accountId, empik.id));
    await db.update(s.marketplaceAccounts).set({ stockDryRun: true }).where(orm.eq(s.marketplaceAccounts.id, empik.id));
    await db.delete(s.stockSyncLog).where(orm.eq(s.stockSyncLog.accountId, empik.id));
  });

  it('builds the product list from Shopify and matches Allegro / Empik listings to it', async () => {
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const accountOf = async (type: 'shopify' | 'allegro' | 'empik') =>
      (await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, type)))[0];
    const [shopify, allegro, empik] = [await accountOf('shopify'), await accountOf('allegro'), await accountOf('empik')];

    // Every demo product comes from Shopify, and the other platforms are linked to it by SKU.
    const catalogue = await db.select().from(s.products);
    expect(catalogue.every((p) => p.shopifyVariantId && p.ean)).toBe(true);
    expect(await m.inventory.needsMatching()).toHaveLength(0);
    // Allegro offers have no SKU: their EAN was read from the offer and matched to the Shopify barcode.
    const allegroListings = await db.select().from(s.productListings).where(orm.eq(s.productListings.accountId, allegro.id));
    expect(allegroListings.length).toBe(catalogue.length);
    for (const l of allegroListings) {
      expect(l.sku).toBeNull();
      expect(catalogue.find((p) => p.id === l.productId)?.ean).toBe(l.ean);
    }

    // A Shopify variant without a SKU still becomes a product.
    const { MockMarketplaceAdapter } = await import('@/server/integrations/marketplaces/mock/adapter');
    const original = MockMarketplaceAdapter.prototype.listListings;
    MockMarketplaceAdapter.prototype.listListings = async function* (this: InstanceType<typeof MockMarketplaceAdapter>) {
      yield* original.call(this);
      if (this.marketplace === 'shopify') {
        yield { externalId: 'gid://shopify/ProductVariant/777', sku: null, ean: '5901234123457', title: 'Luora Night Cream 50 ml - Default Title', quantity: 7, ref: {} };
      }
    };
    try {
      await m.inventory.importListings(shopify.id);
    } finally {
      MockMarketplaceAdapter.prototype.listListings = original;
    }
    const [night] = await db.select().from(s.products).where(orm.eq(s.products.shopifyVariantId, 'gid://shopify/ProductVariant/777'));
    expect(night).toMatchObject({ sku: 'shopify:777', name: 'Luora Night Cream 50 ml', stock: 7, ean: '5901234123457' });

    // An Empik offer from before (its own SKU and product, with a sale) is matched by name and folded in.
    const [legacy] = await db.insert(s.products).values({ sku: 'S1474060', name: 'Old Empik product', stock: 3 }).returning();
    await db.insert(s.stockMovements).values({ productId: legacy.id, delta: -1, reason: 'order' });
    const [empikListing] = await db
      .insert(s.productListings)
      .values({ accountId: empik.id, externalId: '9001', sku: 'S1474060', title: 'Krem do twarzy Luora Night Cream na noc 50ml', productId: legacy.id, lastSeenQty: 4 })
      .returning();
    // An Allegro offer (no SKU) with an order line bought from it.
    const [allegroListing] = await db
      .insert(s.productListings)
      .values({ accountId: allegro.id, externalId: '18800000001', title: 'Luora Night Cream 50 ml – nawilżający krem na noc', lastSeenQty: 2 })
      .returning();
    const [allegroOrder] = await db.select().from(s.orders).where(orm.eq(s.orders.accountId, allegro.id)).limit(1);
    const [line] = await db
      .insert(s.orderItems)
      .values({ orderId: allegroOrder.id, externalLineId: 'night-1', name: 'Luora Night Cream', quantity: 1, unitPrice: '50.00', externalProductId: '18800000001' })
      .returning();

    const groups = await m.inventory.matchingGroups();
    expect(groups.map((g) => [g.listings.map((l) => l.id).sort(), g.suggestions[0]?.productId, g.clear])).toEqual(
      expect.arrayContaining([
        [[empikListing.id], night.id, true],
        [[allegroListing.id], night.id, true],
      ]),
    );
    expect(await m.inventory.confirmClearSuggestions()).toBe(2);
    expect(await m.inventory.needsMatching()).toHaveLength(0);
    expect(await db.select().from(s.products).where(orm.eq(s.products.id, legacy.id))).toHaveLength(0);
    const moved = await db.select().from(s.stockMovements).where(orm.eq(s.stockMovements.productId, night.id));
    expect(moved.map((x) => x.reason).sort()).toEqual(['import', 'order']);
    const [linkedLine] = await db.select().from(s.orderItems).where(orm.eq(s.orderItems.id, line.id));
    expect(linkedLine.productId).toBe(night.id);
    expect((await db.select().from(s.products).where(orm.eq(s.products.id, night.id)))[0].stock).toBe(7); // Shopify's stock is kept

    // An Allegro offer with the same EAN as the Empik one follows when the Empik offer gives the product its barcode.
    await db.update(s.productListings).set({ ean: '5909990000017' }).where(orm.eq(s.productListings.id, empikListing.id));
    await db.update(s.productListings).set({ ean: '5909990000017' }).where(orm.eq(s.productListings.id, allegroListing.id));
    await m.inventory.linkListing(allegroListing.id, null);
    await m.inventory.linkListing(empikListing.id, null);
    await db.update(s.products).set({ ean: null }).where(orm.eq(s.products.id, night.id));
    await m.inventory.linkListing(empikListing.id, night.id);
    expect((await db.select().from(s.products).where(orm.eq(s.products.id, night.id)))[0].ean).toBe('5909990000017');
    expect((await db.select().from(s.productListings).where(orm.eq(s.productListings.id, allegroListing.id)))[0].productId).toBe(night.id);
    // "Sync all": re-reads every platform, then pushes wherever a platform shows another number.
    queue.length = 0;
    await m.inventory.syncAllStock();
    expect(queue.filter((j) => j.name === 'stock-push').map((j) => j.data)).toEqual(
      expect.arrayContaining([{ accountId: allegro.id, force: true }, { accountId: empik.id, force: true }]),
    );
    const pushed = await m.inventory.runStockPush(empik.id, { force: true });
    expect(pushed).toMatchObject({ dryRun: true });
    expect(pushed.pushed).toBeGreaterThan(0);
    queue.length = 0;

    // Unlinking puts a listing back under "Needs matching".
    await m.inventory.linkListing(allegroListing.id, null);
    expect((await m.inventory.needsMatching()).map((l) => l.id)).toEqual([allegroListing.id]);
    await m.inventory.linkListing(allegroListing.id, night.id);
    queue.length = 0;
    // Not a demo product, so the demo clean-up below would leave it.
    await db.delete(s.products).where(orm.eq(s.products.id, night.id));
  });

  it('issues an invoice for any order from the Shipments page: attached on Allegro, PDF only on Shopify', async () => {
    const invoicing = await import('@/server/services/invoicing');
    const db = m.db.getDb();
    const userId = await adminId();
    await invoicing.saveAccounting({
      enabled: true,
      login: '',
      invoiceKey: null,
      settings: { ...invoicing.DEFAULT_ACCOUNTING_SETTINGS },
    });
    const taken = new Set((await db.select({ id: m.schema.invoices.orderId }).from(m.schema.invoices)).map((r) => r.id));
    const altered = await alteredOrders();
    const free = (marketplace: string) =>
      allOrders().then((rows) =>
        rows.find((o) => o.marketplace === marketplace && o.status !== 'cancelled' && !o.invoiceRequest && !taken.has(o.id) && !altered.has(o.id) && o.shippingAddress.countryCode === 'PL' && o.currency === 'PLN'),
      );
    const shopifyOrder = (await free('shopify'))!;
    const allegroOrder = (await free('allegro'))!;
    expect(shopifyOrder && allegroOrder).toBeTruthy();

    // The Accounting page's rule is unchanged: a buyer who didn't ask gets no invoice from there.
    await expect(invoicing.requestInvoice(shopifyOrder.id, userId)).rejects.toThrow('only issued for Allegro and Empik');
    await expect(invoicing.requestInvoice(allegroOrder.id, userId)).rejects.toThrow('did not ask for an invoice');

    // Made out to the delivery address as a private buyer.
    expect(invoicing.invoiceRequestFor(shopifyOrder)).toMatchObject({ name: shopifyOrder.shippingAddress.name, taxId: null, countryCode: 'PL' });

    queue.length = 0;
    const shopifyInvoiceId = await invoicing.requestInvoice(shopifyOrder.id, userId, { anyOrder: true });
    const allegroInvoiceId = await invoicing.requestInvoice(allegroOrder.id, userId, { anyOrder: true });
    await drain();
    const byOrder = await invoicing.invoicesByOrder([shopifyOrder.id, allegroOrder.id]);
    const shopify = byOrder.get(shopifyOrder.id)!;
    const allegro = byOrder.get(allegroOrder.id)!;
    expect([shopify.id, allegro.id]).toEqual([shopifyInvoiceId, allegroInvoiceId]);

    // Shopify: issued and downloadable, nothing to upload.
    expect(shopify).toMatchObject({ state: 'issued', error: null, uploadedAt: null, uploadError: null });
    expect((await invoicing.getInvoicePdf(shopify.id))?.content.subarray(0, 4).toString()).toBe('%PDF');
    // Allegro: also attached to the order.
    expect(allegro).toMatchObject({ state: 'issued', error: null, uploadError: null });
    expect(allegro.uploadedAt).toBeInstanceOf(Date);

    // Retrying a Shopify invoice never tries to upload it.
    await invoicing.retryInvoice(shopify.id, userId);
    await drain();
    expect((await invoicing.invoicesByOrder([shopifyOrder.id])).get(shopifyOrder.id)).toMatchObject({ uploadError: null, state: 'issued' });
    await expect(invoicing.requestInvoice(shopifyOrder.id, userId, { anyOrder: true })).rejects.toThrow('already has an invoice');
    expect((await invoicing.ordersAwaitingInvoice()).map((r) => r.order.id)).not.toContain(shopifyOrder.id);
    // The Shipments page asks for up to 100 orders at once; D1 allows 100 bound values per query, so
    // the lookup goes in chunks and must still find invoices on both sides of a chunk boundary.
    const filler = Array.from({ length: 250 }, (_, i) => `no-such-order-${i}`);
    const many = await invoicing.invoicesByOrder([...filler.slice(0, 120), shopifyOrder.id, ...filler.slice(120), allegroOrder.id]);
    expect([...many.keys()].sort()).toEqual([shopifyOrder.id, allegroOrder.id].sort());
    expect(invoicing.uploadEnabled('shopify', invoicing.DEFAULT_ACCOUNTING_SETTINGS)).toBe(false);
    expect(invoicing.uploadEnabled('allegro', invoicing.DEFAULT_ACCOUNTING_SETTINGS)).toBe(true);
  });

  it('groups Allegro and Empik offers that share an EAN and links them to a Shopify product in one step', async () => {
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const acct = async (type: 'allegro' | 'empik') => (await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, type)))[0];
    const [allegro, empik] = [await acct('allegro'), await acct('empik')];
    const [serum] = await db
      .insert(s.products)
      .values({ sku: 'shopify:5001', name: 'Luora Azelaic Serum 30 ml', stock: 4, shopifyVariantId: 'gid://shopify/ProductVariant/5001' })
      .returning();
    const [a, e] = await db
      .insert(s.productListings)
      .values([
        { accountId: allegro.id, externalId: '18800000777', title: 'Luora Azelaic Acid 10+ Serum 30 ml', ean: '8809640737190', lastSeenQty: 3 },
        { accountId: empik.id, externalId: '88777', sku: 'S777', title: 'LUORA Azelaic Acid Serum 30ml – kojące serum', ean: '8809640737190', lastSeenQty: 5 },
      ])
      .returning();
    const group = (await m.inventory.matchingGroups()).find((g) => g.ean === '8809640737190')!;
    expect(group.listings.map((l) => l.id).sort()).toEqual([a.id, e.id].sort());
    expect(group.suggestions[0].productId).toBe(serum.id);
    expect(group.clear).toBe(true);

    expect(await m.inventory.confirmClearSuggestions()).toBe(2);
    const linked = await db.select().from(s.productListings).where(orm.inArray(s.productListings.id, [a.id, e.id]));
    expect(linked.map((l) => l.productId)).toEqual([serum.id, serum.id]);
    expect((await db.select().from(s.products).where(orm.eq(s.products.id, serum.id)))[0].ean).toBe('8809640737190');
    expect((await m.inventory.matchingGroups()).find((g) => g.ean === '8809640737190')).toBeUndefined();
    await db.delete(s.products).where(orm.eq(s.products.id, serum.id));
  });

  it('imports an order that Allegro cancelled before we ever saw it as Cancelled: no stock taken, no label', async () => {
    const { mapAllegroCheckoutForm } = await import('@/server/integrations/marketplaces/allegro/mapper');
    const form = (await import('./fixtures/allegro/checkout-form.json')).default;
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const [account] = await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, 'allegro'));
    const stockBefore = await productStock();

    const late = mapAllegroCheckoutForm({ ...form, id: '04c89f70-a846-11f1-b5ab-250f33abf7a1', status: 'READY_FOR_PROCESSING', fulfillment: { status: 'CANCELLED' } });
    const result = await m.orders.upsertOrders(account, [late]);
    expect(result.created).toBe(1);
    const [order] = await db.select().from(s.orders).where(orm.eq(s.orders.externalId, late.externalId));
    expect(order).toMatchObject({ status: 'cancelled', readyToShip: false, stockApplied: false, marketplaceStatus: 'READY_FOR_PROCESSING / CANCELLED' });
    expect(await productStock()).toEqual(stockBefore);
    const events = await db.select().from(s.orderEvents).where(orm.eq(s.orderEvents.orderId, order.id));
    expect(events[0].message).toMatch(/Imported from .* \(placed \d+ days ago\)/);

    const carrier = (await db.select().from(s.carrierAccounts))[0];
    await expect(
      m.shipping.requestShipment({ orderId: order.id, carrierAccountId: carrier.id, service: 'x', parcel: { weightKg: 1, lengthCm: 10, widthCm: 10, heightCm: 10 } as never, options: {} }, null),
    ).rejects.toThrow('is cancelled');
  });

  it('insures Allegro Delivery parcels the service requires insurance for, and learns which methods those are', async () => {
    const { MockCarrierAdapter } = await import('@/server/integrations/carriers/mock/adapter');
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const [carrier] = await db.select().from(s.carrierAccounts).where(orm.eq(s.carrierAccounts.type, 'allegro_shipping'));
    const withShipment = new Set((await db.select({ id: s.shipments.orderId }).from(s.shipments)).map((r) => r.id));
    const free = (await allOrders()).filter((o) => o.marketplace === 'allegro' && o.readyToShip && o.status === 'new' && !withShipment.has(o.id));
    expect(free.length).toBeGreaterThanOrEqual(3);
    const [packeta, other, later] = free;
    const parcel = { weightKg: 1, lengthCm: 20, widthCm: 15, heightCm: 5 } as never;
    const label = (orderId: string) => m.shipping.requestShipment({ orderId, carrierAccountId: carrier.id, service: 'buyer_choice', parcel, options: {} }, null);
    const shipmentsOf = (orderId: string) => db.select().from(s.shipments).where(orm.eq(s.shipments.orderId, orderId)).orderBy(s.shipments.createdAt);

    // Packeta / ORLEN Paczka: insured from the start, for what the buyer paid.
    await db.update(s.orders).set({ deliveryMethodId: 'dm-packeta', deliveryMethodName: 'Allegro Wysyłka z Polski do Czech - Automaty Paczkowe Packeta, ORLEN Paczka' }).where(orm.eq(s.orders.id, packeta.id));
    await label(packeta.id);
    expect((await shipmentsOf(packeta.id))[0].options.insuranceAmount).toBe(Number(packeta.totalAmount).toFixed(2));

    // Any other method is untouched, until Allegro refuses it for missing insurance.
    await db.update(s.orders).set({ deliveryMethodId: 'dm-other', deliveryMethodName: 'Allegro Something New' }).where(orm.eq(s.orders.id, other.id));
    const original = MockCarrierAdapter.prototype.createShipment;
    MockCarrierAdapter.prototype.createShipment = async function (this: InstanceType<typeof MockCarrierAdapter>, req) {
      if (req.deliveryMethodId === 'dm-other' && !req.insuranceAmount) {
        return { state: 'failed', externalId: '', error: 'insurance: Ubezpieczenie jest wymagane w celu utworzenia przesyłki (Insurance is required to create a parcel)' };
      }
      return original.call(this, req);
    };
    try {
      await label(other.id);
      expect((await shipmentsOf(other.id))[0].options.insuranceAmount).toBeUndefined();
      await drain(['tracking-push']);
      const [first, retry] = await shipmentsOf(other.id);
      expect(first).toMatchObject({ state: 'failed' });
      expect(first.error).toMatch(/retried automatically with insurance/);
      expect(retry.options.insuranceAmount).toBe(Number(other.totalAmount).toFixed(2));
      expect(retry.state).toBe('created');
      expect((await shipmentsOf(other.id)).length).toBe(2); // exactly one retry

      // Learned: the next order with this method is insured on the first try.
      const [learned] = await db.select().from(s.carrierAccounts).where(orm.eq(s.carrierAccounts.id, carrier.id));
      expect(learned.settings.insuranceMethods).toEqual(['dm-other']);
      await db.update(s.orders).set({ deliveryMethodId: 'dm-other', deliveryMethodName: 'Allegro Something New' }).where(orm.eq(s.orders.id, later.id));
      await label(later.id);
      expect((await shipmentsOf(later.id))[0].options.insuranceAmount).toBe(Number(later.totalAmount).toFixed(2));
      await drain(['tracking-push']);
      expect((await shipmentsOf(later.id)).map((x) => x.state)).toEqual(['created']);
    } finally {
      MockCarrierAdapter.prototype.createShipment = original;
      queue.length = 0;
    }
  });

  it('connects InPost Von Halsky: orders and offers arrive, offers match Shopify products by EAN, stock goes out', async () => {
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const settings = await import('@/server/services/settings');
    const id = await settings.saveMarketplaceAccount({
      type: 'vonhalsky',
      name: 'InPost Von Halsky (test)',
      credentials: { organizationId: '5b0e6b0a-6f5c-4a43-9a53-0d2f9d7a1111', clientId: 'c', clientSecret: 's' },
      settings: {},
      enabled: true,
      stockSyncEnabled: true,
      stockDryRun: true,
    });
    try {
      const summary = await m.orders.syncAccount(id);
      expect(summary.created).toBeGreaterThan(0);
      const vh = await db.select().from(s.orders).where(orm.eq(s.orders.accountId, id));
      expect(vh.length).toBeGreaterThan(0);
      expect(vh.every((o) => o.marketplace === 'vonhalsky' && o.externalNumber.length > 0)).toBe(true);

      await m.inventory.importListings(id);
      const listings = await db.select().from(s.productListings).where(orm.eq(s.productListings.accountId, id));
      expect(listings.length).toBeGreaterThan(0);
      // Same EAN as the Shopify product, so every offer is linked.
      expect(listings.every((l) => l.productId && l.ean)).toBe(true);

      const push = await m.inventory.runStockPush(id);
      expect(push).toMatchObject({ dryRun: true });
    } finally {
      await settings.deleteMarketplaceAccount(id);
      queue.length = 0; // jobs for the removed account
    }
  });

  it('rates products by units sold in the period, ignoring cancelled orders', async () => {
    const { productStats } = await import('@/server/services/product-stats');
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const lines = await db
      .select({ productId: s.orderItems.productId, quantity: s.orderItems.quantity, status: s.orders.status, placedAt: s.orders.placedAt, marketplace: s.orders.marketplace })
      .from(s.orderItems)
      .innerJoin(s.orders, orm.eq(s.orders.id, s.orderItems.orderId));
    const since = Date.now() - 90 * 86_400_000;
    const expected = new Map<string, number>();
    for (const l of lines) {
      if (!l.productId || l.status === 'cancelled' || l.placedAt.getTime() < since) continue;
      expected.set(l.productId, (expected.get(l.productId) ?? 0) + l.quantity);
    }
    expect(expected.size).toBeGreaterThan(0);
    const { byProduct } = await productStats(90);
    for (const [id, units] of expected) expect(byProduct.get(id)?.units).toBe(units);
    const ranked = [...byProduct.values()].filter((p) => p.rank === 1);
    expect(ranked.length).toBeGreaterThan(0);
    expect(Math.max(...[...byProduct.values()].map((p) => p.units))).toBe(ranked[0].units);
  });

  it('reports analytics over the stored orders', async () => {
    const data = await m.analytics.analytics({ from: new Date(Date.now() - 30 * 86_400_000), to: new Date(Date.now() + 60_000) });
    expect(data.kpis.orders).toBeGreaterThan(30);
    expect(data.byMarketplace).toHaveLength(3);
    expect(data.carriers.length).toBeGreaterThan(0);
  });

  it('reports revenue in PLN and keeps products without a SKU apart', async () => {
    const { MockMarketplaceAdapter } = await import('@/server/integrations/marketplaces/mock/adapter');
    const db = m.db.getDb();
    const [allegro] = await db.select().from(m.schema.marketplaceAccounts).where(m.orm.eq(m.schema.marketplaceAccounts.type, 'allegro'));
    const mock = new MockMarketplaceAdapter('allegro', allegro.id);
    const base = mock.buildOrder(9101, new Date());
    const order = {
      ...base,
      externalId: 'czk-order-1',
      externalNumber: 'CZK-1',
      currency: 'CZK',
      totalAmount: '4000.00',
      shippingAmount: '0.00',
      items: [
        { ...base.items[0], externalLineId: 'czk-1', sku: null, name: 'Zzz Cream With No Sku', quantity: 10, unitPrice: '400.00' },
        { ...base.items[0], externalLineId: 'czk-2', sku: null, name: 'Aaa Serum With No Sku', quantity: 1, unitPrice: '10.00' },
      ],
    };
    await m.orders.upsertOrders(allegro, [order], { historical: true });
    const data = await m.analytics.analytics({ from: new Date(Date.now() - 2 * 86_400_000), to: new Date(Date.now() + 60_000) });
    const [stored] = await db.select().from(m.schema.orders).where(m.orm.eq(m.schema.orders.externalId, 'czk-order-1'));
    await db.delete(m.schema.salesLines).where(m.orm.eq(m.schema.salesLines.orderId, stored.id));
    await db.delete(m.schema.orders).where(m.orm.eq(m.schema.orders.id, stored.id));
    const cream = data.topSkus.find((p) => p.name === 'Zzz Cream With No Sku');
    const serum = data.topSkus.find((p) => p.name === 'Aaa Serum With No Sku');
    // Two products, not one "no SKU" row named after whichever sorts first.
    expect(cream?.quantity).toBe(10);
    expect(serum?.quantity).toBe(1);
    // 10 x 400 CZK is about 800 PLN, nowhere near 4,000.
    expect(cream!.revenue).toBeGreaterThan(100);
    expect(cream!.revenue).toBeLessThan(2_000);
    const czkDay = data.daily.reduce((sum, d) => sum + d.revenue, 0);
    expect(czkDay).toBeLessThan(data.kpis.orders * 5_000);
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
    const altered = await alteredOrders();
    const candidates = (await allOrders()).filter((o) => o.marketplace === 'allegro' && o.readyToShip && o.status === 'new' && !o.codAmount && !altered.has(o.id));
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

  it('in manual mode issues nothing on Shipped, and lets an order be marked as invoiced elsewhere', async () => {
    const invoicing = await import('@/server/services/invoicing');
    const db = m.db.getDb();
    const userId = await adminId();
    await invoicing.saveAccounting({ enabled: true, login: '', invoiceKey: null, settings: { ...invoicing.DEFAULT_ACCOUNTING_SETTINGS } });
    expect((await invoicing.loadAccounting()).settings.autoOnShipped).toBe(false);
    const altered = await alteredOrders();
    const order = (await allOrders()).find((o) => o.marketplace === 'allegro' && o.readyToShip && o.status === 'new' && !o.codAmount && !altered.has(o.id))!;
    await db
      .update(m.schema.orders)
      .set({ invoiceRequest: { name: 'Hygge Twist', taxId: '9512513434', euPrefix: null, street: 'Prosta 2', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL' } })
      .where(m.orm.eq(m.schema.orders.id, order.id));

    const form = await m.shipping.shippingFormData(order.id);
    const shipmentId = await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} },
      userId,
    );
    await drain();
    await m.shipping.setPacked(shipmentId, true, userId);
    await drain();
    expect(await invoicing.invoicesForOrder(order.id)).toHaveLength(0);
    const awaitingIds = async () => (await invoicing.ordersAwaitingInvoice()).map((r) => r.order.id);
    expect(await awaitingIds()).toContain(order.id);

    await invoicing.markInvoicedElsewhere(order.id, userId);
    await invoicing.markInvoicedElsewhere(order.id, userId); // twice is harmless
    const marked = await invoicing.invoicesForOrder(order.id);
    expect(marked).toHaveLength(1);
    expect(marked[0].state).toBe('external');
    expect(await awaitingIds()).not.toContain(order.id);
    expect((await invoicing.listInvoices('attention')).map((r) => r.invoice.id)).not.toContain(marked[0].id);
    await expect(invoicing.requestInvoice(order.id, userId)).rejects.toThrow('invoiced outside Luora');
    await drain();
    expect(await invoicing.invoicesForOrder(order.id)).toHaveLength(1);

    await invoicing.undoInvoicedElsewhere(marked[0].id, userId);
    expect(await awaitingIds()).toContain(order.id);
  });

  it('imports past orders as closed history: no stock, labels or invoices, but with their fees and refunds', async () => {
    const history = await import('@/server/services/history');
    const { MOCK_HISTORY_ORDERS } = await import('@/server/integrations/marketplaces/mock/adapter');
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const [allegro] = await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, 'allegro'));
    const stockBefore = await productStock();
    const movementsBefore = (await db.select().from(s.stockMovements)).length;
    const shipmentsBefore = (await db.select().from(s.shipments)).length;
    queue.length = 0;

    await history.startHistoryImport(allegro.id);
    await drain();
    const account = async () => (await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.id, allegro.id)))[0];
    expect(await account()).toMatchObject({ historyState: 'done', historyImported: MOCK_HISTORY_ORDERS, historyError: null });

    const past = await db
      .select()
      .from(s.orders)
      .where(orm.and(orm.eq(s.orders.accountId, allegro.id), orm.eq(s.orders.historical, true)));
    expect(past).toHaveLength(MOCK_HISTORY_ORDERS);
    expect(new Set(past.map((o) => o.status))).toEqual(new Set(['shipped', 'cancelled']));
    expect(past.some((o) => o.discountAmount === null)).toBe(true);
    // Nothing operational happened.
    expect(await productStock()).toEqual(stockBefore);
    expect(await db.select().from(s.stockMovements)).toHaveLength(movementsBefore);
    expect(await db.select().from(s.shipments)).toHaveLength(shipmentsBefore);
    expect(queue.filter((j) => ['shipment-create', 'invoice-auto', 'stock-push'].includes(j.name))).toHaveLength(0);

    const pastOrder = orm.and(orm.eq(s.orders.accountId, allegro.id), orm.eq(s.orders.historical, true));
    const feeCount = async () =>
      (await db.select({ id: s.orderFees.id }).from(s.orderFees).innerJoin(s.orders, orm.eq(s.orders.id, s.orderFees.orderId)).where(pastOrder)).length;
    const pastRefunds = () =>
      db.select({ refund: s.orderRefunds }).from(s.orderRefunds).innerJoin(s.orders, orm.eq(s.orders.id, s.orderRefunds.orderId)).where(pastOrder);
    const refundCount = async () => (await pastRefunds()).length;
    const live = past.filter((o) => o.status !== 'cancelled').length;
    expect(await feeCount()).toBe(live * 2); // commission + Smart delivery
    expect(await refundCount()).toBeGreaterThan(0);
    const [{ refund }] = await pastRefunds();
    expect(refund.orderItemId).toBeTruthy();

    // Importing again finds every order already there and never doubles fees or refunds.
    const fees = await feeCount();
    const refunds = await refundCount();
    await history.startHistoryImport(allegro.id, { restart: true });
    await drain();
    expect(await account()).toMatchObject({ historyState: 'done', historyImported: 0 });
    expect(await feeCount()).toBe(fees);
    expect(await refundCount()).toBe(refunds);
    expect(await db.select().from(s.orders).where(orm.eq(s.orders.historical, true))).toHaveLength(MOCK_HISTORY_ORDERS);
  });

  it('stores fees reported inside live orders once, however often they sync', async () => {
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const [empik] = await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, 'empik'));
    const count = async () =>
      (
        await db
          .select({ id: s.orderFees.id })
          .from(s.orderFees)
          .innerJoin(s.orders, orm.eq(s.orders.id, s.orderFees.orderId))
          .where(orm.eq(s.orders.accountId, empik.id))
      ).length;
    const before = await count();
    expect(before).toBeGreaterThan(0);
    for (const o of (await allOrders()).filter((x) => x.accountId === empik.id).slice(0, 5)) await m.orders.refreshOrder(o.id);
    expect(await count()).toBe(before);
    const [fee] = await db.select().from(s.orderFees).where(orm.eq(s.orderFees.source, 'mirakl')).limit(1);
    expect(fee).toMatchObject({ kind: 'commission' });
    expect(fee.orderItemId).toBeTruthy();
  });

  it('keeps product costs by date, converts purchase prices and imports pasted costs', async () => {
    const costs = await import('@/server/services/costs');
    const fx = await import('@/server/services/fx');
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    const [mug] = await db.select().from(s.products).where(orm.eq(s.products.sku, 'LUO-MUG-01'));
    // The demo seed gave every product a cost "always".
    expect((await costs.currentCosts([mug.id], '2020-01-01')).get(mug.id)?.unitCost).toBe('12.8000');

    await costs.setProductCost(mug.id, { unitCost: 15, effectiveFrom: '2026-01-01' }, null);
    expect((await costs.currentCosts([mug.id], '2025-12-31')).get(mug.id)?.unitCost).toBe('12.8000');
    expect((await costs.currentCosts([mug.id], '2026-06-01')).get(mug.id)?.unitCost).toBe('15.0000');
    // Saving the same date again replaces that entry.
    await costs.setProductCost(mug.id, { unitCost: 16, effectiveFrom: '2026-01-01' }, null);
    expect(await costs.costHistory(mug.id)).toHaveLength(2);

    // USD purchase price + freight, at the (demo) NBP rate of a Monday.
    const entry = await costs.setProductCost(mug.id, { purchasePrice: 3, purchaseCurrency: 'USD', freight: 1, effectiveFrom: '2026-03-02' }, null);
    const rate = (await fx.loadFxTable(['USD'], '2026-03-02', '2026-03-02')).rate('USD', '2026-03-02');
    expect(rate).toBeGreaterThan(3);
    expect(Number(entry.unitCost)).toBeCloseTo(3 * rate! + 1, 3);
    // A Sunday uses Friday's rate.
    expect((await fx.loadFxTable(['USD'], '2026-03-01', '2026-03-01')).rate('USD', '2026-03-01')).toBe(
      (await fx.loadFxTable(['USD'], '2026-02-27', '2026-02-27')).rate('USD', '2026-02-27'),
    );

    const result = await costs.importCosts(costs.parseCostLines('LUO-TSH-M;30\nNo such product;1'), { userId: null, source: 'import', effectiveFrom: '2026-02-01' });
    expect(result).toEqual({ saved: 1, unmatched: ['No such product'] });
    const rows = await costs.listCostRows();
    expect(rows.every((r) => r.cost)).toBe(true);
    expect(rows.find((r) => r.product.sku === 'LUO-TSH-M')?.cost?.source).toBe('import');
    expect(rows.some((r) => r.units90 > 0 && r.revenue90 > 0)).toBe(true);

    await costs.saveAnalyticsSettings({ fallbackCommission: { allegro: 0.1 }, labelCosts: { inpost_locker_standard: 9 } });
    const settings = await costs.loadAnalyticsSettings();
    expect(settings.fallbackCommission).toMatchObject({ allegro: 0.1, empik: 0.15 });
    expect(settings.labelCosts).toMatchObject({ inpost_locker_standard: 9, inpost_courier_standard: 15.5 });
    await expect(costs.saveAnalyticsSettings({ thinMargin: 0.2, healthyMargin: 0.15 })).rejects.toThrow('Margin bands');
  });

  it('keeps a profit line for every sold item, rebuilt when costs change', async () => {
    const profit = await import('@/server/services/profit');
    const costs = await import('@/server/services/costs');
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    queue.length = 0;
    await profit.recomputeAll();
    await drain();
    const lines = await db.select().from(s.salesLines);
    const live = await db
      .select({ id: s.orderItems.id })
      .from(s.orderItems)
      .innerJoin(s.orders, orm.eq(s.orders.id, s.orderItems.orderId))
      .where(orm.ne(s.orders.status, 'cancelled'));
    expect(lines).toHaveLength(live.length);
    expect(lines.every((l) => l.day.match(/^\d{4}-\d{2}-\d{2}$/) && l.fxRate === 1)).toBe(true);
    // Demo fees arrive with the orders, so nothing is estimated except Von Halsky (none here).
    expect(lines.filter((l) => l.feesEstimated)).toHaveLength(0);
    // Every line linked to a product with a cost knows its cost; unlinked lines don't.
    const withCost = new Set((await db.select({ productId: s.productCosts.productId }).from(s.productCosts)).map((c) => c.productId));
    expect(lines.filter((l) => l.productId && withCost.has(l.productId)).every((l) => l.costKnown)).toBe(true);
    expect(lines.filter((l) => !l.productId).every((l) => !l.costKnown && l.cost === 0)).toBe(true);
    for (const l of lines.slice(0, 20)) {
      expect(l.profit).toBeCloseTo(l.net - l.fees - l.cost + l.shipping - l.delivery - l.refunds, 1);
    }
    const cancelled = await db.select({ id: s.orders.id }).from(s.orders).where(orm.eq(s.orders.status, 'cancelled'));
    expect(cancelled.length).toBeGreaterThan(0);
    expect(lines.some((l) => cancelled.some((c) => c.id === l.orderId))).toBe(false);
    expect(lines.some((l) => l.refunds > 0)).toBe(true);

    // A cost change from a date applies to orders from that day on.
    const [mug] = await db.select().from(s.products).where(orm.eq(s.products.sku, 'LUO-MUG-01'));
    const mugLines = () => db.select().from(s.salesLines).where(orm.eq(s.salesLines.productId, mug.id));
    const before = await mugLines();
    const cutoff = [...new Set(before.map((l) => l.day))].sort()[Math.floor(before.length / 2)];
    await costs.setProductCost(mug.id, { unitCost: 100, effectiveFrom: cutoff }, null);
    await profit.recomputeAll();
    await drain();
    for (const l of await mugLines()) {
      const unit = l.cost / l.quantity;
      if (l.day >= cutoff) expect(unit).toBe(100);
      else expect(unit).toBeLessThan(100);
    }

    // A new label on an order brings its configured cost in.
    const order = (await allOrders()).find((o) => o.status === 'new' && o.marketplace === 'shopify' && o.pickupPointId)!;
    const deliveryOf = async () =>
      (await db.select().from(s.salesLines).where(orm.eq(s.salesLines.orderId, order.id))).reduce((sum, l) => sum + l.delivery, 0);
    const form = await m.shipping.shippingFormData(order.id);
    await m.shipping.requestShipment(
      { orderId: order.id, carrierAccountId: form.route!.carrierAccountId, service: form.route!.service, parcel: m.shipping.presetToParcel(form.defaultPreset!), options: {} },
      null,
    );
    await drain(['tracking-push']);
    const settings = await costs.loadAnalyticsSettings();
    expect(await deliveryOf()).toBeCloseTo((settings.labelCosts[form.route!.service] ?? settings.defaultLabelCost) + settings.packagingCost, 1);
    queue.length = 0;
  });

  it('feeds the analytics pages from the profit lines', async () => {
    const dataset = await import('@/server/analytics/dataset');
    const { analyticsView } = await import('@/server/analytics/view');
    const db = m.db.getDb();
    const lines = await db.select().from(m.schema.salesLines);
    const data = await dataset.loadBusinessData();
    expect(data.lineItems).toHaveLength(lines.length);
    expect(data.orders).toHaveLength(new Set(lines.map((l) => l.orderId)).size);
    const gross = lines.reduce((s, l) => s + l.gross, 0);
    const profit = lines.reduce((s, l) => s + l.profit, 0);
    expect(data.lineItems.reduce((s, l) => s + l.revenuePLN, 0)).toBeCloseTo(gross, 2);

    const all = dataset.snapshotFor(data, dataset.periodFor(data, 'all'));
    expect(all.totals.revenuePLN).toBeCloseTo(gross, 2);
    expect(all.totals.marginPLN).toBeCloseTo(profit, 2);
    expect(all.kpis).toHaveLength(5);
    expect(all.health.score).toBeGreaterThan(0);
    expect(all.products.length).toBeGreaterThan(0);
    // Brands and categories fall back to the name when Shopify gave none.
    expect(all.products.every((p) => p.brand && p.category)).toBe(true);

    const empik = await analyticsView({ marketplace: 'empik', period: 'year' });
    expect(empik.data.lineItems.length).toBeGreaterThan(0);
    expect(empik.data.lineItems.every((l) => l.source === 'empik')).toBe(true);
    expect(empik.params).toMatchObject({ marketplace: 'empik', period: 'year' });

    const margins = await dataset.productMargins(400);
    expect(margins.size).toBeGreaterThan(0);
  });

  it('links every order to a customer, across marketplaces, with lifetime totals', async () => {
    const customers = await import('@/server/services/customers');
    const db = m.db.getDb();
    const { schema: s, orm } = m;
    queue.length = 0;
    // Past orders imported earlier may not be linked yet: the backfill catches up.
    while ((await customers.resolveMissingCustomers()).remaining);
    expect(await db.select().from(s.orders).where(orm.isNull(s.orders.customerId))).toHaveLength(0);

    const list = await customers.allCustomers();
    expect(list.length).toBeGreaterThan(10);
    // Demo buyers use real-looking e-mails, so one person who bought on two marketplaces is one customer.
    expect(list.some((c) => c.marketplaces.length > 1)).toBe(true);
    const [top] = [...list].sort((a, b) => b.ordersCount - a.ordersCount);
    const lines = await db.select().from(s.salesLines).where(orm.eq(s.salesLines.customerId, top.id));
    expect(top.revenue).toBeCloseTo(lines.reduce((sum, l) => sum + l.gross, 0), 1);
    const live = await db
      .select()
      .from(s.orders)
      .where(orm.and(orm.eq(s.orders.customerId, top.id), orm.ne(s.orders.status, 'cancelled')));
    expect(top.ordersCount).toBe(live.length);

    // The same Allegro buyer behind relay e-mails is one customer; a different buyer id is another.
    const { MockMarketplaceAdapter } = await import('@/server/integrations/marketplaces/mock/adapter');
    const [allegro] = await db.select().from(s.marketplaceAccounts).where(orm.eq(s.marketplaceAccounts.type, 'allegro'));
    const mock = new MockMarketplaceAdapter('allegro', allegro.id);
    const build = (index: number, buyerId: string, email: string) => {
      const o = mock.buildOrder(index, new Date());
      return { ...o, buyer: { ...o.buyer, name: `Relay ${buyerId}`, email }, shippingAddress: { ...o.shippingAddress, email }, raw: { buyer: { id: buyerId } } };
    };
    await m.orders.upsertOrders(allegro, [build(9001, 'BUYER-1', 'a1@allegromail.pl'), build(9002, 'BUYER-1', 'zz@allegromail.pl'), build(9003, 'BUYER-2', 'a1@allegromail.pl')], { historical: true });
    const relay = await db.select().from(s.orders).where(orm.like(orm.sql`json_extract(${s.orders.buyer}, '$.name')`, 'Relay %'));
    const byBuyer = (name: string) => new Set(relay.filter((o) => o.buyer.name === name).map((o) => o.customerId));
    expect(byBuyer('Relay BUYER-1').size).toBe(1);
    expect([...byBuyer('Relay BUYER-2')][0]).not.toBe([...byBuyer('Relay BUYER-1')][0]);
    const relayCustomer = list.find((c) => c.id === [...byBuyer('Relay BUYER-1')][0]) ?? (await customers.loadCustomer([...byBuyer('Relay BUYER-1')][0]!))!.customer;
    expect(relayCustomer.email).toBeNull();

    // Merging moves orders, notes and tasks, and the totals follow.
    const target = [...byBuyer('Relay BUYER-1')][0]!;
    const source = [...byBuyer('Relay BUYER-2')][0]!;
    const userId = await adminId();
    await customers.addCustomerNote(source, 'Prefers fragrance-free', userId);
    const taskService = await import('@/server/services/tasks');
    await taskService.createTask({ title: 'Send a sample', customerId: source, assigneeIds: [userId] }, { id: userId });
    await customers.mergeCustomers(target, [source]);
    const merged = await customers.loadCustomer(target);
    expect(merged!.orders).toHaveLength(3);
    expect(merged!.notes.map((n) => n.note.body)).toContain('Prefers fragrance-free');
    expect(merged!.identities.map((i) => i.value).sort()).toEqual(['BUYER-1', 'BUYER-2']);
    expect(await customers.loadCustomer(source)).toBeNull();
    // The task moved with the merge: it is now about the customer that was kept.
    expect((await taskService.listTasks({ assignee: userId, status: 'open' })).map((t) => [t.title, t.customerId])).toContainEqual(['Send a sample', target]);
    const dupes = await customers.duplicateSuggestions();
    expect(Array.isArray(dupes)).toBe(true);
  });

  it('writes the chosen segments to Shopify customers as tags, sending only changes', async () => {
    const crm = await import('@/server/services/crm-sync');
    const calls: { id: string; add: string[]; remove: string[] }[] = [];
    crm.setShopifyCustomerApi({
      findCustomer: async (email) => ({ id: `gid://shopify/Customer/${email}`, tags: [], subscribed: email.startsWith('a') }),
      updateCustomerTags: async (id, add, remove) => void calls.push({ id, add, remove }),
    });
    try {
      await crm.saveCrmSettings({ syncSegments: ['new', 'one_time', 'promising', 'loyal', 'vip', 'at_risk', 'cant_lose', 'lost'], dryRun: true });
      const dry = await crm.runCrmSync();
      expect(dry.dryRun).toBe(true);
      expect(dry.changes).toBeGreaterThan(0);
      expect(calls).toHaveLength(0);

      await crm.saveCrmSettings({ syncSegments: ['new', 'one_time', 'promising', 'loyal', 'vip', 'at_risk', 'cant_lose', 'lost'], dryRun: false });
      queue.length = 0;
      let result = await crm.runCrmSync();
      while (queue.some((j) => j.name === 'crm-shopify-sync')) {
        queue.length = 0;
        result = await crm.runCrmSync();
      }
      expect(result.errors).toEqual([]);
      expect(calls.length).toBe(dry.changes);
      expect(calls.every((c) => c.add.length === 1 && c.add[0].startsWith('luora-'))).toBe(true);
      // Only Shopify buyers: nobody who bought solely on Allegro or Empik.
      const db = m.db.getDb();
      const synced = await db.select().from(m.schema.customers).where(m.orm.isNotNull(m.schema.customers.syncedTags));
      expect(synced.every((c) => c.marketplaces.includes('shopify'))).toBe(true);
      expect(synced.every((c) => c.shopifyCustomerId?.startsWith('gid://shopify/Customer/'))).toBe(true);
      expect((await crm.runCrmSync()).changes).toBe(0);
    } finally {
      crm.setShopifyCustomerApi(undefined);
      queue.length = 0;
    }
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
