// Publishing Shopify products to Allegro and Empik, against a local D1 database and the demo marketplaces.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

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
      { sku: 'NEW-A', name: 'New cream A', ean: '5900000000010', stock: 5, shopifyVariantId: 'gid://shopify/ProductVariant/9001' },
      { sku: 'NEW-B', name: 'New cream B', ean: '5900000000011', stock: 3, shopifyVariantId: 'gid://shopify/ProductVariant/9002' },
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
    expect(byName.get('NEW-B')).toMatchObject({ catalogue: 'missing', problems: ['not in the catalogue'] });
    expect(byName.get('NEW-C')!.problems).toEqual(['no EAN']);
  });

  it('creates only the ready products and reports the others', async () => {
    const ids = (await m.db.getDb().select().from(m.schema.products).where(m.orm.inArray(m.schema.products.sku, ['NEW-A', 'NEW-B']))).map((p) => p.id);
    const result = await m.offers.publishOffers(empikId, ids);
    expect(result.created).toEqual(['New cream A']);
    expect(result.failed).toEqual([{ name: 'New cream B', error: 'not ready: not in the catalogue' }]);
  });

  it('refuses an empty choice and more than the limit', async () => {
    await expect(m.offers.publishOffers(empikId, [])).rejects.toThrow('Choose at least one product');
    await expect(m.offers.publishOffers(empikId, Array.from({ length: 26 }, (_, i) => String(i)))).rejects.toThrow('at most 25');
  });

  it('only works for Allegro and Empik accounts', async () => {
    const shopify = (await m.db.getDb().select().from(m.schema.marketplaceAccounts)).find((a) => a.type === 'shopify')!;
    await expect(m.offers.publishPreview(shopify.id)).rejects.toThrow('Allegro and Empik accounts');
    expect(allegroId).toBeTruthy();
  });
});
