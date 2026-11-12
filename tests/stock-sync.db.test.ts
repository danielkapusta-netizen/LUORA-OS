// A full stock update against a local D1 database and the demo marketplaces, which remember what they were sent:
// read, send, read back and compare; plus taking Shopify's numbers and putting an offer back on sale.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('full stock update (D1)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-d1-'));
  let dispose: (() => Promise<void>) | undefined;
  const queue: { name: string; data: unknown }[] = [];
  let m: {
    db: typeof import('@/server/db/client');
    s: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    inventory: typeof import('@/server/services/inventory');
    sync: typeof import('@/server/services/stock-sync');
    handlers: typeof import('@/server/jobs/handlers');
  };

  async function drain() {
    for (let i = 0; i < 100 && queue.length; i++) {
      const job = queue.shift()!;
      await m.handlers.runJob(job.name as never, job.data as never);
    }
  }
  const account = async (type: 'shopify' | 'allegro' | 'empik') => (await m.db.getDb().select().from(m.s.marketplaceAccounts).where(m.orm.eq(m.s.marketplaceAccounts.type, type)))[0];
  const product = async (sku: string) => (await m.db.getDb().select().from(m.s.products).where(m.orm.eq(m.s.products.sku, sku)))[0];
  const listing = async (accountId: string, sku: string) => {
    const p = await product(sku);
    const { and, eq } = m.orm;
    return (await m.db.getDb().select().from(m.s.productListings).where(and(eq(m.s.productListings.accountId, accountId), eq(m.s.productListings.productId, p.id))))[0];
  };
  const goLive = (id: string) => m.db.getDb().update(m.s.marketplaceAccounts).set({ stockSyncEnabled: true, stockDryRun: false }).where(m.orm.eq(m.s.marketplaceAccounts.id, id));

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    const { resetMockOffers } = await import('@/server/integrations/marketplaces/mock/adapter');
    resetMockOffers();
    const queueModule = await import('@/server/jobs/queue');
    queueModule.setEnqueueImplementation(async (name, data) => void queue.push({ name, data }));
    const { seed } = await import('@/server/db/seed');
    await seed();
    m = {
      db: await import('@/server/db/client'),
      s: await import('@/server/db/schema'),
      orm: await import('drizzle-orm'),
      inventory: await import('@/server/services/inventory'),
      sync: await import('@/server/services/stock-sync'),
      handlers: await import('@/server/jobs/handlers'),
    };
    queue.length = 0;
  }, 120_000);

  afterAll(async () => {
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  it('reads the demo offers with their states: a bundle, a sold-out offer and one switched off by hand', async () => {
    const [shopify, allegro, empik] = [await account('shopify'), await account('allegro'), await account('empik')];
    expect(await listing(shopify.id, 'LUO-SET-01')).toMatchObject({ stockLocked: 'bundle', active: true });
    expect(await listing(allegro.id, 'LUO-CND-01')).toMatchObject({ active: false, soldOut: true, listingStatus: 'ENDED', lastSeenQty: 0 });
    expect(await listing(empik.id, 'LUO-NTB-A5')).toMatchObject({ active: false, soldOut: false });
    expect((await product('LUO-MUG-01')).brand).toBe('Luora Home');
  });

  it('takes Shopify’s numbers as the stock, for one product or for all that differ', async () => {
    const db = m.db.getDb();
    const shopify = await account('shopify');
    const mug = await product('LUO-MUG-01');
    const bag = await product('LUO-BAG-01');
    const shown = (await listing(shopify.id, 'LUO-MUG-01')).lastSeenQty!;
    await db.update(m.s.products).set({ stock: 0 }).where(m.orm.inArray(m.s.products.id, [mug.id, bag.id]));

    expect(await m.inventory.adoptMarketplaceStock({ accountId: shopify.id, productIds: [mug.id], userId: null })).toBe(1);
    expect((await product('LUO-MUG-01')).stock).toBe(shown);
    expect((await product('LUO-BAG-01')).stock).toBe(0);
    const [movement] = await db.select().from(m.s.stockMovements).where(m.orm.and(m.orm.eq(m.s.stockMovements.productId, mug.id), m.orm.eq(m.s.stockMovements.reason, 'marketplace')));
    expect(movement).toMatchObject({ delta: shown, note: `Taken from ${shopify.name}` });

    expect(await m.inventory.adoptMarketplaceStock({ accountId: shopify.id, userId: null })).toBe(1);
    expect((await product('LUO-BAG-01')).stock).toBe((await listing(shopify.id, 'LUO-BAG-01')).lastSeenQty);
    expect(await m.inventory.adoptMarketplaceStock({ accountId: shopify.id, userId: null })).toBe(0);
    queue.length = 0;
  });

  it('sends, reads back and reports per marketplace; a dry-run account is only compared', async () => {
    const [shopify, allegro, empik] = [await account('shopify'), await account('allegro'), await account('empik')];
    await goLive(allegro.id);
    await goLive(empik.id);

    const { run, started } = await m.sync.startSyncRun('manual', null);
    expect(started).toBe(true);
    // A second press while it runs does not start another.
    expect((await m.sync.startSyncRun('manual', null)).started).toBe(false);
    await drain();

    const done = (await m.sync.latestSyncRun())!;
    expect(done).toMatchObject({ id: run.id, status: 'done' });
    const by = new Map(done.accounts.map((a) => [a.accountId, a]));
    // Shopify is still in dry run: nothing sent, and nothing differs after its numbers were taken (the bundle is not counted).
    expect(by.get(shopify.id)).toMatchObject({ step: 'done', live: false, sent: 0, differing: 0, matching: 6 });
    // Allegro got every number, including the sold-out candle, which is on sale again.
    expect(by.get(allegro.id)).toMatchObject({ step: 'done', live: true, sent: 6, refused: 0, matching: 6, differing: 0 });
    expect(await listing(allegro.id, 'LUO-CND-01')).toMatchObject({ active: true, soldOut: false, lastSeenQty: (await product('LUO-CND-01')).stock });
    // Empik: five follow the stock (two already showed it, three were sent it); the notebook was switched off by hand, so it is left alone.
    expect(by.get(empik.id)).toMatchObject({ step: 'done', sent: 3, matching: 5, differing: 0 });
    expect(await listing(empik.id, 'LUO-NTB-A5')).toMatchObject({ active: false, lastPushedQty: null });
  });

  it('reports what does not arrive, after sending it a second time', async () => {
    const db = m.db.getDb();
    const allegro = await account('allegro');
    const { MockMarketplaceAdapter } = await import('@/server/integrations/marketplaces/mock/adapter');
    const { vi } = await import('vitest');
    await db.update(m.s.products).set({ stock: 3 }).where(m.orm.eq(m.s.products.sku, 'LUO-TSH-M'));
    // The marketplace says yes and changes nothing.
    const spy = vi.spyOn(MockMarketplaceAdapter.prototype, 'setStock').mockResolvedValue([]);
    try {
      await m.sync.startSyncRun('schedule', null);
      await drain();
      // Allegro and Empik each: once, and once more after the check found the old number.
      expect(spy).toHaveBeenCalledTimes(4);
    } finally {
      spy.mockRestore();
    }
    const result = (await m.sync.latestSyncRun())!.accounts.find((a) => a.accountId === allegro.id)!;
    expect(result).toMatchObject({ step: 'done', differing: 1, matching: 5 });
    expect(result.problems).toEqual([expect.objectContaining({ title: 'T-shirt Luora, rozmiar M', want: 3 })]);
  });

  it('records a marketplace that cannot be read instead of stopping the others', async () => {
    const [allegro, empik] = [await account('allegro'), await account('empik')];
    const { MockMarketplaceAdapter } = await import('@/server/integrations/marketplaces/mock/adapter');
    const { vi } = await import('vitest');
    const original = MockMarketplaceAdapter.prototype.listListings;
    const spy = vi.spyOn(MockMarketplaceAdapter.prototype, 'listListings').mockImplementation(function (this: InstanceType<typeof MockMarketplaceAdapter>) {
      if (this.marketplace === 'empik') throw new Error('Empik (HTTP 503): down');
      return original.call(this);
    });
    try {
      await m.sync.startSyncRun('manual', null);
      await drain();
    } finally {
      spy.mockRestore();
    }
    const run = (await m.sync.latestSyncRun())!;
    expect(run.status).toBe('done');
    expect(run.accounts.find((a) => a.accountId === empik.id)).toMatchObject({ step: 'failed', error: expect.stringContaining('HTTP 503') });
    expect(run.accounts.find((a) => a.accountId === allegro.id)).toMatchObject({ step: 'done', differing: 0 });
  });

  it('puts an offer back on sale: Allegro activates it, Empik only takes the quantity and says it is still off', async () => {
    const db = m.db.getDb();
    const [allegro, empik] = [await account('allegro'), await account('empik')];
    // Ended by hand on Allegro: off sale with units left.
    const bag = await listing(allegro.id, 'LUO-BAG-01');
    await db.update(m.s.productListings).set({ active: false, soldOut: false, listingStatus: 'ENDED' }).where(m.orm.eq(m.s.productListings.id, bag.id));
    const want = (await product('LUO-BAG-01')).stock;
    expect(await m.inventory.activateListing(bag.id)).toMatchObject({ onSale: true, quantity: want });
    expect(await listing(allegro.id, 'LUO-BAG-01')).toMatchObject({ active: true, lastPushedQty: want, lastSeenQty: want });

    const notebook = await listing(empik.id, 'LUO-NTB-A5');
    expect(await m.inventory.activateListing(notebook.id)).toMatchObject({ onSale: false, status: 'inactive' });

    await db.update(m.s.products).set({ stock: 0 }).where(m.orm.eq(m.s.products.sku, 'LUO-NTB-A5'));
    await expect(m.inventory.activateListing(notebook.id)).rejects.toThrow(/no stock/);
    const shopify = await account('shopify');
    await expect(m.inventory.activateListing((await listing(shopify.id, 'LUO-MUG-01')).id)).rejects.toThrow(/dry run/);
    queue.length = 0;
  });

  it('stops sending to an offer the marketplace no longer has, and takes it back when it returns', async () => {
    const db = m.db.getDb();
    const allegro = await account('allegro');
    const [extra] = await db
      .insert(m.s.productListings)
      .values({ accountId: allegro.id, externalId: 'allegro-deleted', title: 'Deleted on Allegro', productId: (await product('LUO-MUG-01')).id, lastSeenQty: 4, lastSeenAt: new Date(Date.now() - 86_400_000) })
      .returning();
    expect((await m.inventory.importListings(allegro.id)).gone).toBe(1);
    const [gone] = await db.select().from(m.s.productListings).where(m.orm.eq(m.s.productListings.id, extra.id));
    expect(gone).toMatchObject({ active: false, listingStatus: 'GONE' });
    expect(m.inventory.desiredQuantity({ stock: 5, ...gone })).toBeNull();
    // Reading again does not count it a second time, and the offers that are there stay as they were.
    expect((await m.inventory.importListings(allegro.id)).gone).toBe(0);
    expect(await listing(allegro.id, 'LUO-TSH-L')).toMatchObject({ active: true });
  });
});
