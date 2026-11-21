// Publishing Shopify products to Allegro and Empik, against a local D1 database and the demo marketplaces.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

describe('publishing offers (D1, demo marketplaces)', { timeout: 60_000 }, () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-offers-'));
  let dispose: (() => Promise<void>) | undefined;
  let m: {
    db: typeof import('@/server/db/client');
    schema: typeof import('@/server/db/schema');
    orm: typeof import('drizzle-orm');
    offers: typeof import('@/server/services/marketplace-offers');
  };
  let allegroId: string;
  let empikId: string;

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
      offers: await import('@/server/services/marketplace-offers'),
    };
    const accounts = await m.db.getDb().select().from(m.schema.marketplaceAccounts);
    allegroId = accounts.find((a) => a.type === 'allegro')!.id;
    empikId = accounts.find((a) => a.type === 'empik')!.id;
  }, 120_000);

  afterAll(async () => {
    (await import('@/server/jobs/queue')).setEnqueueImplementation(undefined);
    await dispose?.();
    rmSync(persistTo, { recursive: true, force: true });
  });

  it('shows products that have no offer in the account, with the catalogue verdict and the marked-up price', async () => {
    const db = m.db.getDb();
    // Two products that only exist in Shopify: one the demo catalogue knows (even last digit), one it doesn't.
    await db.insert(m.schema.products).values([
      { sku: 'NEW-A', name: 'Luora new cream A', ean: '5900000000010', stock: 5, shopifyVariantId: 'gid://shopify/ProductVariant/9001' },
      { sku: 'NEW-B', name: 'Luora new cream B', ean: '5900000000011', stock: 3, shopifyVariantId: 'gid://shopify/ProductVariant/9002' },
      { sku: 'NEW-C', name: 'No barcode', ean: null, stock: 1, shopifyVariantId: 'gid://shopify/ProductVariant/9003' },
    ]);
    await db
      .update(m.schema.marketplaceAccounts)
      .set({ settings: { offerMarkupPercent: 10, offerRounding: 'x.00' } })
      .where(m.orm.eq(m.schema.marketplaceAccounts.id, empikId));

    const { rows, setupProblems } = await m.offers.publishPreview(empikId);
    expect(setupProblems).toEqual([]);
    const byName = new Map(rows.map((r) => [r.sku, r]));
    expect(byName.get('NEW-A')).toMatchObject({ catalogue: 'found', problems: [] });
    expect(Number(byName.get('NEW-A')!.price)).toBe(Math.ceil(Number(byName.get('NEW-A')!.shopifyPrice) * 1.1 - 0.005));
    // Empik's lookup is only advice (its own import decides); Allegro cannot list a product its catalogue lacks.
    expect(byName.get('NEW-B')).toMatchObject({ catalogue: 'missing', problems: [] });
    expect(byName.get('NEW-C')!.problems).toEqual(['no EAN']);
    // Allegro proposes the product its catalogue doesn't know, once it has a photo and the details its category needs.
    const preview = await m.offers.publishPreview(allegroId);
    const allegro = new Map(preview.rows.map((r) => [r.sku, r]));
    expect(allegro.get('NEW-B')).toMatchObject({ catalogue: 'missing', problems: ['no photo (a new product needs one)', 'needs: Pojemność'] });
    expect(allegro.get('NEW-B')!.allegro!.newProduct).toEqual({ categoryId: 'demo-cat-1', categoryPath: 'Uroda > Pielęgnacja > Kremy', categorySaved: false });
    expect(preview.allegroNew?.missingParameters).toEqual([{ name: 'Pojemność', products: 1 }]);
  });

  it('creates only the ready products and reports the others', async () => {
    const ids = (await m.db.getDb().select().from(m.schema.products).where(m.orm.inArray(m.schema.products.sku, ['NEW-A', 'NEW-B']))).map((p) => p.id);
    // Allegro skips the product its catalogue doesn't know.
    const allegro = await m.offers.publishOffers(allegroId, ids);
    expect(allegro.created).toEqual(['Luora new cream A']);
    expect(allegro.failed).toEqual([{ name: 'Luora new cream B', error: 'not ready: no photo (a new product needs one), needs: Pojemność' }]);
    // Empik is asked to take both; it is Empik's import that would refuse a product it doesn't know.
    const empik = await m.offers.publishOffers(empikId, ids);
    expect(empik.created.sort()).toEqual(['Luora new cream A', 'Luora new cream B']);
    expect(empik.failed).toEqual([]);
  });

  it('proposes a product Allegro doesn’t know once its category and details are set up', async () => {
    const db = m.db.getDb();
    await db.insert(m.schema.products).values({ sku: 'NEW-D', name: 'Luora new cream D', ean: '5900000000031', stock: 4, imageUrl: 'https://img/d.jpg', shopifyVariantId: 'gid://shopify/ProductVariant/9004' });
    const product = (await db.select().from(m.schema.products).where(m.orm.eq(m.schema.products.sku, 'NEW-D')))[0];
    expect((await m.offers.publishOffers(allegroId, [product.id])).failed).toEqual([{ name: 'Luora new cream D', error: 'not ready: needs: Pojemność' }]);
    await m.offers.saveAllegroParameterSource(allegroId, 'Pojemność', { metafield: 'custom.capacity', fallback: '50 ml' });
    await m.offers.saveAllegroCategory(allegroId, '', { id: 'demo-cat-2', path: 'Uroda > Pielęgnacja > Zestawy' });
    const row = (await m.offers.publishPreview(allegroId)).rows.find((r) => r.sku === 'NEW-D')!;
    expect(row).toMatchObject({ problems: [], allegro: { newProduct: { categoryId: 'demo-cat-2', categorySaved: true } } });
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await m.offers.publishOffers(allegroId, [product.id]);
    expect(result).toMatchObject({ created: ['Luora new cream D'], notes: ['Luora new cream D: new product proposed'] });
    expect(log).toHaveBeenCalledWith(expect.stringContaining('as a new product in demo-cat-2'));
    log.mockRestore();
  });

  it('creates Erli products with the Allegro category of the same product', async () => {
    const db = m.db.getDb();
    const [erli] = await db.insert(m.schema.marketplaceAccounts).values({ type: 'erli', name: 'Erli (demo)', settings: { demo: true, offerMarkupPercent: 5 } }).returning();
    await db.insert(m.schema.products).values({ sku: 'NEW-E', name: 'Luora new cream E', ean: '5900000000040', stock: 6, imageUrl: 'https://img/e.jpg', shopifyVariantId: 'gid://shopify/ProductVariant/9005' });
    const preview = await m.offers.publishPreview(erli.id);
    const row = preview.rows.find((r) => r.sku === 'NEW-E')!;
    // Erli has no catalogue; the category comes from the Allegro catalogue product with the same EAN.
    expect(row).toMatchObject({ catalogue: null, problems: [], allegro: { title: 'Luora new cream E', erliCategory: { source: 'catalogue' } } });
    expect(row.allegro!.erliCategory!.attributes).toBeGreaterThan(0);
    // A product without a photo can't be created on Erli.
    expect(preview.rows.find((r) => r.sku === 'NEW-A')!.problems).toContain('no photo');
    const product = (await db.select().from(m.schema.products).where(m.orm.eq(m.schema.products.sku, 'NEW-E')))[0];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const result = await m.offers.publishOffers(erli.id, [product.id]);
    expect(result.created).toEqual(['Luora new cream E']);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('[mock erli] create offer NEW-E'));
    log.mockRestore();
  });

  it('uses the barcode as the offer SKU when Shopify has none, and does not offer the product twice', async () => {
    const db = m.db.getDb();
    await db.insert(m.schema.products).values({ sku: 'shopify:777', name: 'No SKU cream', ean: '5900000000020', stock: 2, shopifyVariantId: 'gid://shopify/ProductVariant/777' });
    const row = (await m.offers.publishPreview(empikId)).rows.find((r) => r.name.startsWith('No SKU'))!;
    expect(row).toMatchObject({ sku: 'shopify:777', catalogue: 'found', problems: [] });
    const product = (await db.select().from(m.schema.products).where(m.orm.eq(m.schema.products.sku, 'shopify:777')))[0];
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    await m.offers.publishOffers(empikId, [product.id]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining('create offer 5900000000020 '));
    log.mockRestore();
    // Once Empik lists it under the barcode, it is no longer offered.
    const empik = (await db.select().from(m.schema.marketplaceAccounts).where(m.orm.eq(m.schema.marketplaceAccounts.id, empikId)))[0];
    await db.insert(m.schema.productListings).values({ accountId: empik.id, externalId: 'x1', sku: '5900000000020', title: 'No SKU cream', ref: {}, productId: null, lastSeenQty: 2, lastSeenAt: new Date() });
    expect((await m.offers.publishPreview(empikId)).rows.some((r) => r.name.startsWith('No SKU'))).toBe(false);
  });

  it('refuses an empty choice and more than the limit', async () => {
    await expect(m.offers.publishOffers(empikId, [])).rejects.toThrow('Choose at least one product');
    await expect(m.offers.publishOffers(empikId, Array.from({ length: 26 }, (_, i) => String(i)))).rejects.toThrow('at most 25');
  });

  it('only works for Allegro, Empik, HEBE and Erli accounts', async () => {
    const shopify = (await m.db.getDb().select().from(m.schema.marketplaceAccounts)).find((a) => a.type === 'shopify')!;
    await expect(m.offers.publishPreview(shopify.id)).rejects.toThrow('Allegro, Empik, HEBE and Erli accounts');
    expect(allegroId).toBeTruthy();
  });
});
