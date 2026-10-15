// The Pricing page's service against a local D1 database and the demo marketplaces.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

describe('pricing (D1, demo marketplaces)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-pricing-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    pricing: typeof import('@/server/services/pricing');
  };
  let allegroId: string;

  const listing = async (id: string) => (await m.db.getDb().select().from(m.schema.productListings).where(m.orm.eq(m.schema.productListings.id, id)))[0];

  beforeAll(async () => {
    process.env.INTEGRATIONS_MODE = 'mock';
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo });
    dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    (await import('@/server/jobs/queue')).setEnqueueImplementation(async () => undefined);
    await (await import('@/server/db/seed')).seed();
    m = {
      db: await import('@/server/db/client'),
      schema: await import('@/server/db/schema'),
      orm: await import('drizzle-orm'),
      pricing: await import('@/server/services/pricing'),
    };
    const inventory = await import('@/server/services/inventory');
    const accounts = await m.db.getDb().select().from(m.schema.marketplaceAccounts);
    allegroId = accounts.find((a) => a.type === 'allegro')!.id;
    // Shopify first, as it defines the products; the others link to them by barcode.
    for (const type of ['shopify', 'allegro', 'empik', 'vonhalsky'] as const) {
      for (const a of accounts.filter((x) => x.type === type)) await inventory.importListings(a.id);
    }
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  it('stores the price each marketplace reports, and shows it per product with the Shopify price beside it', async () => {
    const view = await m.pricing.pricingView('allegro');
    const listed = view.rows.filter((r) => r.listings.length > 0);
    expect(listed.length).toBeGreaterThan(0);
    for (const r of listed) {
      expect(r.listings[0].price).toMatch(/^\d+\.\d{2}$/);
      expect(r.shopifyPrice).toMatch(/^\d+\.\d{2}$/);
      // The demo Allegro charges 5% more than the demo Shopify.
      expect(Number(r.listings[0].price)).toBeCloseTo(Number(r.shopifyPrice) * 1.05, 1);
    }
    expect((await m.pricing.pricingView('shopify')).rows.every((r) => r.listings.length === 1)).toBe(true);
  });

  it('sends a new price and remembers it, accepting a Polish comma', async () => {
    const row = (await m.pricing.pricingView('allegro')).rows.find((r) => r.listings.length > 0)!;
    const target = row.listings[0];
    const result = await m.pricing.pushPrices([{ listingId: target.id, price: '123,4' }]);
    expect(result).toEqual({ updated: 1, unchanged: 0, failed: [] });
    expect(await listing(target.id)).toMatchObject({ price: '123.40', priceError: null, priceManual: true });
    expect((await listing(target.id)).priceUpdatedAt).toBeInstanceOf(Date);
  });

  it('skips a price that is already there, and refuses what is not a price, without touching the rest', async () => {
    const rows = (await m.pricing.pricingView('allegro')).rows.filter((r) => r.listings.length > 0);
    const [a, b, c] = rows.map((r) => r.listings[0]);
    const before = await listing(b.id);
    const result = await m.pricing.pushPrices([
      { listingId: a.id, price: '123.40' },
      { listingId: b.id, price: 'free' },
      { listingId: c.id, price: '0' },
    ]);
    expect(result.updated).toBe(0);
    expect(result.unchanged).toBe(1);
    expect(result.failed.map((f) => f.listingId)).toEqual([b.id, c.id]);
    expect(result.failed[0].message).toContain('not a price');
    expect(await listing(b.id)).toMatchObject({ price: before.price, priceManual: false });
  });

  it('keeps the platform’s reason on the listing when it refuses a price, and the other prices still go through', async () => {
    const [refused, accepted] = (await m.pricing.pricingView('empik')).rows.filter((r) => r.listings.length > 0).map((r) => r.listings[0]);
    const before = await listing(refused.id);
    const result = await m.pricing.pushPrices([
      { listingId: refused.id, price: '0,50' },
      { listingId: accepted.id, price: '33.30' },
    ]);
    expect(result.updated).toBe(1);
    expect(result.failed).toEqual([{ listingId: refused.id, title: refused.title, message: expect.stringContaining('minimum is 1.00') }]);
    expect(await listing(refused.id)).toMatchObject({ price: before.price, priceError: expect.stringContaining('minimum'), priceManual: false });
    expect(await listing(accepted.id)).toMatchObject({ price: '33.30', priceError: null, priceManual: true });
    // A price the platform takes clears the earlier reason.
    expect((await m.pricing.pushPrices([{ listingId: refused.id, price: '12.00' }])).updated).toBe(1);
    expect(await listing(refused.id)).toMatchObject({ price: '12.00', priceError: null });
  });

  it('refuses a listing of a switched-off account or one not linked to a product', async () => {
    const db = m.db.getDb();
    const rows = (await m.pricing.pricingView('allegro')).rows.filter((r) => r.listings.length > 0);
    const [first, second] = rows.map((r) => r.listings[0]);
    await db.update(m.schema.marketplaceAccounts).set({ enabled: false }).where(m.orm.eq(m.schema.marketplaceAccounts.id, allegroId));
    const off = await m.pricing.pushPrices([{ listingId: first.id, price: '10.00' }]);
    expect(off.failed[0].message).toContain('switched off');
    await db.update(m.schema.marketplaceAccounts).set({ enabled: true }).where(m.orm.eq(m.schema.marketplaceAccounts.id, allegroId));

    await db.update(m.schema.productListings).set({ productId: null }).where(m.orm.eq(m.schema.productListings.id, second.id));
    const unlinked = await m.pricing.pushPrices([{ listingId: second.id, price: '10.00' }]);
    expect(unlinked.failed[0].message).toContain('Link this offer');
    expect((await m.pricing.pricingView('allegro')).unlinked).toBeGreaterThan(0);
  });

  it('refuses more prices than the page shows, and unknown listings', async () => {
    await expect(m.pricing.pushPrices(Array.from({ length: m.pricing.MAX_PRICES_PER_PUSH + 1 }, (_, i) => ({ listingId: `l${i}`, price: '1.00' })))).rejects.toThrow('at most');
    const result = await m.pricing.pushPrices([{ listingId: 'nope', price: '1.00' }]);
    expect(result.failed[0].message).toContain('no longer exists');
  });

  it('shows what the marketplace reports after the next import, even when that differs from what was sent', async () => {
    const [target] = (await m.pricing.pricingView('allegro')).rows.flatMap((r) => r.listings).filter((l) => l.priceManual);
    await m.db.getDb().update(m.schema.productListings).set({ price: '77.70' }).where(m.orm.eq(m.schema.productListings.id, target.id));
    const { importListings } = await import('@/server/services/inventory');
    await importListings(allegroId);
    // The demo Allegro still charges its own price, so the import puts that back; the manual flag stays.
    expect(await listing(target.id)).toMatchObject({ priceManual: true });
    expect((await listing(target.id)).price).not.toBe('77.70');
  });
});
