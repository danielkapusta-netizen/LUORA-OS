import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, insertMany } from '@/server/db/client';
import { marketplaceAccounts, pricingRecommendations, productListings, products } from '@/server/db/schema';
import { importPricingResearch, researchCatalog } from '@/server/services/pricing-research';
import { pricingView } from '@/server/services/pricing';

describe('pricing research (D1)', () => {
  const persistTo = mkdtempSync(path.join(tmpdir(), 'luora-research-'));
  let dispose: (() => Promise<void>) | undefined;
  let accountId: string;
  let otherAccountId: string;
  let productId: string;
  let listingId: string;
  const variantId = 'gid://shopify/ProductVariant/123';
  const timestamp = Date.now() - 60_000;
  const item = (time = timestamp) => ({ shopifyVariantId: variantId, accountId, marketplace: 'empik', listingId,
    status: 'change_price', recommendedPrice: '58.89', observedLuoraPrice: '69.90', researchedAt: new Date(time).toISOString(),
    rationale: 'Main Empik 62.99 zł; lowest SkinKo 58.90 zł; Luora 69.90 zł. Test if margin permits; verify main seller after the change.',
    sources: [{ label: 'Main Empik', url: 'https://www.empik.pl/product,p123,kosmetyki-p' }],
  });
  const saved = () => getDb().select().from(pricingRecommendations).where(eq(pricingRecommendations.productId, productId));
  beforeAll(async () => {
    const { localBindings, applyMigrations } = await import('@/server/local-bindings');
    const bindings = await localBindings({ persistTo }); dispose = bindings.dispose;
    await applyMigrations(bindings.env.DB);
    const db = getDb();
    [accountId, otherAccountId] = (await db.insert(marketplaceAccounts).values([
      { type: 'empik', name: 'Luora', credentials: 'do-not-expose' }, { type: 'hebe', name: 'Luora Daniel Kapusta' },
    ]).returning({ id: marketplaceAccounts.id })).map((a) => a.id);
    [{ id: productId }] = await db.insert(products).values({ sku: 'synthetic-sku', name: 'Celimax serum', shopifyVariantId: variantId, ean: '1234567890123' }).returning({ id: products.id });
    [{ id: listingId }] = await db.insert(productListings).values({ productId, accountId, externalId: '1234', title: 'Celimax serum', price: '69.90', currency: 'PLN' }).returning({ id: productListings.id });
  }, 120_000);
  afterAll(async () => { await dispose?.(); rmSync(persistTo, { recursive: true, force: true }); });

  it('imports recommendations without changing marketplace prices or push state', async () => {
    const before = await getDb().select().from(productListings);
    expect(await importPricingResearch({ runId: 'run-1', recommendations: [item()] })).toEqual({ received: 1, applied: 1, ignoredOlderOrEqual: 0 });
    expect(await getDb().select().from(productListings)).toEqual(before);
    const view = await pricingView('empik');
    expect(view.rows.find((r) => r.product.id === productId)?.recommendations[0]).toMatchObject({ recommendedPrice: '58.89', accountName: 'Luora', listingId });
    expect((await saved())[0].researchedAt.getTime()).toBe(timestamp);
  });
  it('is idempotent and cannot let a late older run replace newer research', async () => {
    expect((await importPricingResearch({ runId: 'retry', recommendations: [item()] })).applied).toBe(0);
    expect((await importPricingResearch({ runId: 'older', recommendations: [{ ...item(timestamp - 1000), recommendedPrice: '1.00' }] })).applied).toBe(0);
    expect((await importPricingResearch({ runId: 'newer', recommendations: [{ ...item(timestamp + 1000), recommendedPrice: '58.79' }] })).applied).toBe(1);
    expect((await saved())[0]).toMatchObject({ runId: 'newer', recommendedPrice: '58.79' });
  });
  it('validates every record before writing any part of a batch', async () => {
    const before = await saved();
    await expect(importPricingResearch({ runId: 'invalid', recommendations: [item(timestamp + 2000), { ...item(), shopifyVariantId: 'missing', accountId: otherAccountId, marketplace: 'hebe', sources: [{ label: 'HEBE', url: 'https://www.hebe.pl/product' }] }] })).rejects.toThrow('Unknown Shopify variant');
    expect(await saved()).toEqual(before);
    await expect(importPricingResearch({ runId: 'wrong-account', recommendations: [{ ...item(), accountId: otherAccountId }] })).rejects.toThrow('mismatched');
    await expect(importPricingResearch({ runId: 'wrong-offer', recommendations: [{ ...item(), listingId: 'unknown' }] })).rejects.toThrow('Offer does not belong');
    await expect(importPricingResearch({ runId: 'already-listed', recommendations: [{ ...item(), status: 'add_listing', listingId: null, recommendedPrice: null, observedLuoraPrice: null }] })).rejects.toThrow('offer already exists');
  });
  it('keeps a missing-listing recommendation scoped to its marketplace account', async () => {
    await importPricingResearch({ runId: 'missing-hebe', recommendations: [{ ...item(), accountId: otherAccountId, marketplace: 'hebe', listingId: null,
      status: 'add_listing', recommendedPrice: null, observedLuoraPrice: null, rationale: 'No matching listing found after retry. Add this product to HEBE.', sources: [] }] });
    const row = (await pricingView('hebe')).rows.find((r) => r.product.id === productId)!;
    expect(row.listings).toHaveLength(0);
    expect(row.recommendations).toHaveLength(1);
    expect(row.recommendations[0].status).toBe('add_listing');
    expect((await pricingView('shopify')).rows.every((r) => r.recommendations.length === 0)).toBe(true);
  });
  it('exports stable mapping and pricing fields without credentials', async () => {
    const catalog = await researchCatalog();
    expect(catalog.accounts.find((a) => a.id === accountId)).toEqual({ id: accountId, marketplace: 'empik', name: 'Luora' });
    expect(catalog.products.find((p) => p.id === productId)).toMatchObject({ shopifyVariantId: variantId, listings: [{ id: listingId, accountId, price: '69.90' }] });
    expect(JSON.stringify(catalog)).not.toContain('do-not-expose');
    expect(JSON.stringify(catalog)).not.toContain('credentials');
  });
  it('imports a full 100-record batch within D1 parameter limits and paginates the catalog without gaps', async () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ sku: `RESEARCH-${i}`, name: `Research product ${i}`, shopifyVariantId: `gid://shopify/ProductVariant/${200 + i}` }));
    await insertMany(getDb(), products, rows);
    const result = await importPricingResearch({ runId: 'full-batch', recommendations: rows.map((p) => ({ ...item(), shopifyVariantId: p.shopifyVariantId,
      listingId: null, status: 'needs_review', recommendedPrice: null, observedLuoraPrice: null, rationale: 'Seller details could not be verified after refreshing; recheck.', sources: [] })) });
    expect(result.applied).toBe(100);
    const first = await researchCatalog();
    const second = await researchCatalog(first.nextCursor!);
    const third = await researchCatalog(second.nextCursor!);
    expect([first.products.length, second.products.length, third.products.length]).toEqual([50, 50, 1]);
    expect(third.nextCursor).toBeNull();
    expect(new Set([...first.products, ...second.products, ...third.products].map((p) => p.id)).size).toBe(101);
  }, 30_000);
});
