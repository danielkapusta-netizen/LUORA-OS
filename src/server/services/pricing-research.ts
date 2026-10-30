import { and, asc, eq, gt, inArray, isNotNull, sql } from 'drizzle-orm';
import { isResearchMarketplace, RESEARCH_MARKETPLACES, researchImportSchema } from '../../lib/pricing-research';
import { chunk, getDb } from '../db/client';
import { marketplaceAccounts, pricingRecommendations, productListings, products } from '../db/schema';

export class ResearchInputError extends Error {}

/** Stable identifiers and pricing data only: no account credentials, orders or customers. */
export async function researchCatalog(after?: string) {
  const db = getDb();
  const accounts = await db.select({ id: marketplaceAccounts.id, marketplace: marketplaceAccounts.type, name: marketplaceAccounts.name })
    .from(marketplaceAccounts).where(and(eq(marketplaceAccounts.enabled, true), inArray(marketplaceAccounts.type, [...RESEARCH_MARKETPLACES])));
  const rows = await db.select({ id: products.id, shopifyVariantId: products.shopifyVariantId, sku: products.sku, ean: products.ean, name: products.name, stock: products.stock })
    .from(products).where(and(isNotNull(products.shopifyVariantId), after ? gt(products.id, after) : undefined)).orderBy(asc(products.id)).limit(51);
  const page = rows.slice(0, 50);
  const listings = page.length ? await db.select({ id: productListings.id, productId: productListings.productId, accountId: productListings.accountId,
    marketplace: marketplaceAccounts.type, externalId: productListings.externalId, price: productListings.price, currency: productListings.currency, active: productListings.active })
    .from(productListings).innerJoin(marketplaceAccounts, eq(marketplaceAccounts.id, productListings.accountId))
    .where(and(inArray(productListings.productId, page.map((p) => p.id)), eq(marketplaceAccounts.enabled, true), inArray(marketplaceAccounts.type, ['shopify', ...RESEARCH_MARKETPLACES]))) : [];
  return {
    accounts,
    products: page.map((p) => ({ ...p, listings: listings.filter((l) => l.productId === p.id).map((l) => ({
      id: l.id, accountId: l.accountId, marketplace: l.marketplace, externalId: l.externalId, price: l.price, currency: l.currency, active: l.active,
    })) })),
    nextCursor: rows.length > 50 ? page.at(-1)!.id : null,
  };
}

/** Validate the whole batch before writing; D1 batch makes the independent upserts atomic. */
export async function importPricingResearch(input: unknown) {
  const parsed = researchImportSchema.safeParse(input);
  if (!parsed.success) throw new ResearchInputError(parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const { runId, recommendations } = parsed.data;
  const db = getDb();
  const accountIds = [...new Set(recommendations.map((r) => r.accountId))];
  const variantIds = [...new Set(recommendations.map((r) => r.shopifyVariantId))];
  const listingIds = [...new Set(recommendations.flatMap((r) => r.listingId ? [r.listingId] : []))];
  const accountRows = (await Promise.all(chunk(accountIds).map((ids) => db.select({ id: marketplaceAccounts.id, type: marketplaceAccounts.type, enabled: marketplaceAccounts.enabled }).from(marketplaceAccounts).where(inArray(marketplaceAccounts.id, ids))))).flat();
  const productRows = (await Promise.all(chunk(variantIds).map((ids) => db.select({ id: products.id, variantId: products.shopifyVariantId }).from(products).where(inArray(products.shopifyVariantId, ids))))).flat();
  const listingRows = (await Promise.all(chunk(listingIds).map((ids) => db.select().from(productListings).where(inArray(productListings.id, ids))))).flat();
  const accounts = new Map(accountRows.map((a) => [a.id, a]));
  const productMap = new Map(productRows.map((p) => [p.variantId, p.id]));
  const listings = new Map(listingRows.map((l) => [l.id, l]));
  const addProductIds = [...new Set(recommendations.filter((r) => r.status === 'add_listing').map((r) => productMap.get(r.shopifyVariantId)).filter((id): id is string => Boolean(id)))];
  const existingOffers = (await Promise.all(chunk(addProductIds).map((ids) => db.select({ productId: productListings.productId, accountId: productListings.accountId })
    .from(productListings).where(inArray(productListings.productId, ids))))).flat();
  const existingKeys = new Set(existingOffers.map((l) => JSON.stringify([l.productId, l.accountId])));
  const statements = recommendations.map((r, index) => {
    const fail = (reason: string): never => { throw new ResearchInputError(`recommendations.${index}: ${reason}`); };
    const account = accounts.get(r.accountId);
    if (!account?.enabled || !isResearchMarketplace(account.type) || account.type !== r.marketplace) fail('Unknown, disabled or mismatched marketplace account');
    const productId = productMap.get(r.shopifyVariantId) ?? fail('Unknown Shopify variant; refresh the research catalog');
    if (r.status === 'add_listing' && existingKeys.has(JSON.stringify([productId, r.accountId]))) fail('An offer already exists; check its placement or activation instead');
    if (r.listingId) {
      const listing = listings.get(r.listingId);
      if (!listing || listing.productId !== productId || listing.accountId !== r.accountId) fail('Offer does not belong to this product and account');
      if (r.status === 'change_price' && listing!.currency !== 'PLN') fail('Price proposals support PLN offers only');
    }
    return db.insert(pricingRecommendations).values({
      productId, accountId: r.accountId, listingId: r.listingId, status: r.status,
      recommendedPrice: r.recommendedPrice, observedLuoraPrice: r.observedLuoraPrice,
      rationale: r.rationale, sources: r.sources, researchedAt: new Date(r.researchedAt), runId,
    }).onConflictDoUpdate({
      target: [pricingRecommendations.productId, pricingRecommendations.accountId],
      set: { listingId: r.listingId, status: r.status, recommendedPrice: r.recommendedPrice, observedLuoraPrice: r.observedLuoraPrice,
        rationale: r.rationale, sources: r.sources, researchedAt: new Date(r.researchedAt), runId, updatedAt: new Date() },
      setWhere: sql`excluded.researched_at > ${pricingRecommendations.researchedAt}`,
    }).returning({ id: pricingRecommendations.id });
  });
  const results = await db.batch(statements as [typeof statements[number], ...typeof statements]);
  const applied = results.reduce((n, rows) => n + rows.length, 0);
  return { received: recommendations.length, applied, ignoredOlderOrEqual: recommendations.length - applied };
}
