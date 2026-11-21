// Creating offers on Allegro, Empik and HEBE from the Shopify product list. Only products the marketplace catalogue
// already knows (by EAN) are offered; the offer's price is Shopify's price plus a markup. Once an offer exists,
// importing the account's listings links it to the product and the normal stock sync takes over.
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { markupPrice } from '../../lib/offers';
import { hasRealSku } from '../../lib/sku';
import { getDb } from '../db/client';
import { marketplaceAccounts, productListings, products, type MarketplaceSettings } from '../db/schema';
import { isMockMode } from '../env';
import { ShopifyAdapter, type ShopifyVariantDetails } from '../integrations/marketplaces/shopify/adapter';
import { isOfferPublisher, type CatalogueMatch, type OfferDraft, type OfferPublisher } from '../integrations/marketplaces/types';
import { MOCK_CATALOG } from '../integrations/marketplaces/mock/adapter';
import { AllegroAdapter } from '../integrations/marketplaces/allegro/adapter';
import { offerFieldMetafieldKeys, resolveOfferFields } from '../integrations/marketplaces/mirakl/offer-fields';
import { allegroDescription, allegroTitle, gpsrChoice } from '../integrations/marketplaces/allegro/offer-content';
import { parameterMetafieldKeys, productParameters, type AllegroCategoryParameter } from '../integrations/marketplaces/allegro/product-parameters';
import { getMarketplaceAdapter, loadMarketplaceAccount } from './accounts';
import { importListings } from './inventory';
import { miraklOfferFields } from './settings';
import { msg } from '@/lib/i18n/msg';

export const MAX_OFFERS_PER_RUN = 25;

export function publishPrice(shopifyPrice: string | number, settings: MarketplaceSettings): string {
  return markupPrice(shopifyPrice, settings.offerMarkupPercent ?? 0, settings.offerRounding ?? 'x.99');
}

async function shopifyDetails(
  variantIds: string[],
  rows: { variantId: string | null; name: string; brand: string | null; imageUrl: string | null; sku: string }[],
  metafieldKeys: string[] = [],
): Promise<Map<string, ShopifyVariantDetails>> {
  if (isMockMode()) {
    // Demo mode has no Shopify: describe the products from what the database knows.
    return new Map(
      rows.flatMap((p) =>
        p.variantId
          ? [
              [
                p.variantId,
                {
                  variantId: p.variantId,
                  title: p.name,
                  descriptionHtml: '<p>Demo product</p>',
                  vendor: p.brand ?? 'Demo',
                  productType: '',
                  price: String(MOCK_CATALOG.find((c) => c.sku === p.sku)?.price ?? '49.99'),
                  ean: null,
                  sku: p.sku,
                  imageUrls: p.imageUrl ? [p.imageUrl] : [],
                  weightGrams: null,
                  metafields: {},
                } as unknown as ShopifyVariantDetails,
              ] as const,
            ]
          : [],
      ),
    );
  }
  const [account] = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.type, 'shopify'), eq(marketplaceAccounts.enabled, true)))
    .limit(1);
  if (!account) throw new Error(msg('There is no Shopify account'));
  const adapter = getMarketplaceAdapter(account);
  if (!(adapter instanceof ShopifyAdapter)) throw new Error(msg('Shopify adapter is not available'));
  return adapter.variantDetails(variantIds, metafieldKeys);
}

function publisher(account: Awaited<ReturnType<typeof loadMarketplaceAccount>>): OfferPublisher {
  if (account.type !== 'allegro' && account.type !== 'empik' && account.type !== 'hebe') throw new Error(msg('Offers can be created here for Allegro, Empik and HEBE accounts'));
  const adapter = getMarketplaceAdapter(account);
  if (!isOfferPublisher(adapter)) throw new Error(msg('This account cannot create offers'));
  return adapter;
}

export type CatalogueState = 'found' | 'missing' | 'unverified';

export interface PublishRow {
  productId: string;
  variantId: string;
  sku: string;
  name: string;
  ean: string | null;
  imageUrl: string | null;
  shopifyPrice: string | null;
  price: string | null;
  stock: number;
  catalogue: CatalogueState | null;
  problems: string[];
  /** Allegro: what the offer will show, so the preview matches what is sent. */
  allegro?: AllegroPreview;
}

export interface AllegroPreview {
  /** The title sent, fitted to Allegro's 75 characters. */
  title: string;
  shortened: boolean;
  /** Shopify photos sent (at most 16); none means Allegro's catalogue photos. */
  photos: number;
  /** Whether Shopify's description is sent; otherwise Allegro's catalogue description is shown. */
  description: boolean;
  /** Names of the responsible person and producer, and whether they come from the product (else the account default). */
  responsiblePerson: string | null;
  responsibleProducer: string | null;
  gpsrFromProduct: boolean;
  /** Set when the catalogue doesn't know the product, so it is proposed as a new product in this category. */
  newProduct?: { categoryId: string | null; categoryPath: string | null; categorySaved: boolean };
}

/** Products the catalogue doesn't know: their categories per product type and the parameters still to set up. */
export interface AllegroNewProducts {
  types: { productType: string; products: number; saved: { id: string; path: string } | null; suggestions: { id: string; path: string }[] }[];
  /** Parameter names some product still needs, and how many products need each. */
  missingParameters: { name: string; products: number }[];
  /** Parameters already set up. */
  sources: { name: string; metafield: string; fallback: string }[];
}

/** The Allegro offer's content for one product, and what stops it from being sent. */
function allegroContent(settings: MarketplaceSettings, d: ShopifyVariantDetails) {
  const options = settings.allegroOptions;
  const title = allegroTitle(d.title);
  const person = gpsrChoice('responsible person', settings.allegroResponsiblePersonMetafield, d.metafields, options?.responsiblePersons, settings.allegroResponsiblePersonId);
  const producer = gpsrChoice('responsible producer', settings.allegroResponsibleProducerMetafield, d.metafields, options?.responsibleProducers, settings.allegroResponsibleProducerId);
  const problems = [title, person, producer].flatMap((c) => (c.ok ? [] : [c.problem]));
  const nameOf = (list: { id: string; name: string }[] | undefined, id: string | undefined) => (id ? list?.find((o) => o.id === id)?.name ?? id : null);
  const preview: AllegroPreview = {
    title: title.title,
    shortened: title.ok && title.shortened,
    photos: Math.min(16, d.imageUrls.length),
    description: allegroDescription(d.descriptionHtml) !== null,
    responsiblePerson: person.ok ? nameOf(options?.responsiblePersons, person.id) : null,
    responsibleProducer: producer.ok ? nameOf(options?.responsibleProducers, producer.id) : null,
    gpsrFromProduct: (person.ok && person.fromProduct) || (producer.ok && producer.fromProduct),
  };
  return {
    preview,
    problems,
    responsiblePersonId: person.ok ? person.id : undefined,
    responsibleProducerId: producer.ok ? producer.id : undefined,
  };
}

/** Shopify metafields the account reads per product: Mirakl's extra offer fields, Allegro's responsible person and producer. */
function productMetafieldKeys(settings: MarketplaceSettings, marketplace: string): string[] {
  const keys = offerFieldMetafieldKeys(settings);
  if (marketplace === 'allegro') {
    for (const k of [settings.allegroResponsiblePersonMetafield, settings.allegroResponsibleProducerMetafield]) if (k?.trim()) keys.push(k.trim());
    keys.push(...parameterMetafieldKeys(settings.allegroParameterSources));
  }
  return [...new Set(keys)];
}

export interface PublishPreview {
  rows: PublishRow[];
  /** What is missing in the account's settings; nothing can be created until it is fixed. */
  setupProblems: string[];
  /** Allegro: what new products (unknown to the catalogue) need. */
  allegroNew?: AllegroNewProducts;
}

type Loaded = {
  row: PublishRow;
  match: CatalogueMatch | null;
  details: ShopifyVariantDetails | null;
  gpsr: Pick<OfferDraft, 'responsiblePersonId' | 'responsibleProducerId'>;
  newProduct?: OfferDraft['allegroNewProduct'];
};

/** At most this many category suggestions are asked for per page (Allegro allows 5 per second). */
const MAX_SUGGESTIONS = 60;

/**
 * Category and parameters for the products Allegro's catalogue doesn't know. The category is the one saved for the
 * product type, else Allegro's first suggestion for the type's name (or the title, for products without a type).
 * Fills each row's problems and preview, and returns the summary for the page.
 */
async function prepareNewProducts(pub: OfferPublisher, settings: MarketplaceSettings, rows: (Loaded & { productType: string })[]): Promise<AllegroNewProducts> {
  const summary: AllegroNewProducts = {
    types: [],
    missingParameters: [],
    sources: Object.entries(settings.allegroParameterSources ?? {}).map(([name, s]) => ({ name, metafield: s.metafield ?? '', fallback: s.fallback ?? '' })),
  };
  if (!pub.suggestCategories || !pub.categoryParameters) return summary;
  const suggestions = new Map<string, { id: string; path: string }[] | Error>();
  const parameters = new Map<string, AllegroCategoryParameter[] | Error>();
  const suggest = async (phrase: string) => {
    if (!suggestions.has(phrase)) {
      if (suggestions.size >= MAX_SUGGESTIONS) return new Error('too many products at once; save a category for the type');
      suggestions.set(phrase, await pub.suggestCategories!(phrase).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))));
    }
    return suggestions.get(phrase)!;
  };
  const paramsOf = async (categoryId: string) => {
    if (!parameters.has(categoryId)) parameters.set(categoryId, await pub.categoryParameters!(categoryId).catch((e: unknown) => (e instanceof Error ? e : new Error(String(e)))));
    return parameters.get(categoryId)!;
  };
  const missingCount = new Map<string, number>();
  const types = new Map<string, AllegroNewProducts['types'][number]>();

  for (const r of rows) {
    const d = r.details!;
    const saved = settings.allegroCategoryMap?.[r.productType] ?? null;
    const phrase = r.productType.trim() || d.title;
    const found = await suggest(phrase);
    const list = found instanceof Error ? [] : found;
    const category = saved ?? list[0] ?? null;
    const type = types.get(r.productType) ?? { productType: r.productType, products: 0, saved, suggestions: list };
    type.products++;
    types.set(r.productType, type);

    r.row.problems = r.row.problems.filter((p) => p !== 'not in the catalogue');
    if (r.row.allegro) r.row.allegro.newProduct = { categoryId: category?.id ?? null, categoryPath: category?.path ?? null, categorySaved: Boolean(saved) };
    if (d.imageUrls.length === 0) r.row.problems.push('no photo (a new product needs one)');
    if (!category) {
      r.row.problems.push(found instanceof Error ? `no Allegro category (${found.message})` : 'no Allegro category: save one for the product type');
      continue;
    }
    const params = await paramsOf(category.id);
    if (params instanceof Error) {
      r.row.problems.push(`Allegro category parameters not read (${params.message})`);
      continue;
    }
    const filled = productParameters(params, { ean: r.row.ean ?? '', brand: d.vendor, metafields: d.metafields }, settings.allegroParameterSources);
    if (filled.missing.length) r.row.problems.push(`needs: ${filled.missing.join(', ')}`);
    r.row.problems.push(...filled.invalid);
    for (const name of filled.missing) missingCount.set(name, (missingCount.get(name) ?? 0) + 1);
    r.newProduct = { categoryId: category.id, parameters: filled.productParameters, offerParameters: filled.offerParameters };
  }
  summary.types = [...types.values()].sort((a, b) => a.productType.localeCompare(b.productType));
  summary.missingParameters = [...missingCount].map(([name, products]) => ({ name, products })).sort((a, b) => b.products - a.products);
  return summary;
}

async function loadRows(
  accountId: string,
  onlyIds?: Set<string>,
): Promise<{ rows: Loaded[]; setupProblems: string[]; settings: MarketplaceSettings; allegroNew?: AllegroNewProducts }> {
  const db = getDb();
  // A Mirakl marketplace's extra offer fields are read once a day; if it can't be asked, its import still decides.
  try {
    await miraklOfferFields(accountId);
  } catch (err) {
    console.warn('[offers] extra offer fields not loaded:', err instanceof Error ? err.message : err);
  }
  let account = await loadMarketplaceAccount(accountId);
  const pub = publisher(account);
  const setupProblems = pub.publishSetupProblems();
  // Per-product responsible persons are matched to Allegro's current list, so a person just added there counts.
  if (account.type === 'allegro' && (account.settings.allegroResponsiblePersonMetafield?.trim() || account.settings.allegroResponsibleProducerMetafield?.trim())) {
    try {
      const allegroOptions = await loadAllegroOptions(accountId, false, GPSR_OPTIONS_TTL_MS);
      account = { ...account, settings: { ...account.settings, allegroOptions } };
    } catch (err) {
      console.warn('[offers] Allegro responsible persons not refreshed:', err instanceof Error ? err.message : err);
    }
  }

  const items = await db
    .select({ id: products.id, name: products.name, ean: products.ean, sku: products.sku, stock: products.stock, imageUrl: products.imageUrl, brand: products.brand, variantId: products.shopifyVariantId })
    .from(products)
    .where(isNotNull(products.shopifyVariantId))
    .orderBy(asc(products.name));
  const listings = await db.select({ productId: productListings.productId, ean: productListings.ean, sku: productListings.sku }).from(productListings).where(eq(productListings.accountId, accountId));
  const linked = new Set(listings.map((l) => l.productId).filter(Boolean));
  const eans = new Set(listings.map((l) => l.ean).filter(Boolean));
  const skus = new Set(listings.map((l) => l.sku?.toLowerCase()).filter(Boolean));
  const missing = items.filter((p) => !linked.has(p.id) && !(p.ean && eans.has(p.ean)) && !skus.has(p.sku.toLowerCase()) && !(p.ean && skus.has(p.ean)) && (!onlyIds || onlyIds.has(p.id)));
  if (missing.length === 0) return { rows: [], setupProblems, settings: account.settings };

  const details = await shopifyDetails(missing.map((p) => p.variantId!), missing, productMetafieldKeys(account.settings, account.type));
  const wanted = [...new Set(missing.map((p) => p.ean).filter((e): e is string => Boolean(e)))];
  const catalogue = wanted.length ? await pub.checkCatalogue(wanted) : new Map<string, CatalogueMatch>();

  const rows = missing.map((p): Loaded => {
    const d = details.get(p.variantId!) ?? null;
    const match = p.ean ? catalogue.get(p.ean) ?? null : null;
    const problems: string[] = [];
    if (!d) problems.push('not found in Shopify');
    if (!p.ean) problems.push('no EAN');
    // Allegro needs the catalogue product to attach to. On Mirakl (Empik, HEBE) the lookup is only advice: its own import accepts or refuses the offer, with the reason.
    else if (match && !match.found && account.type === 'allegro') problems.push('not in the catalogue');
    if (d && Number(d.price) <= 0) problems.push('no price');
    if (d) problems.push(...resolveOfferFields(account.settings, d.metafields).problems);
    const allegro = d && account.type === 'allegro' ? allegroContent(account.settings, d) : null;
    if (allegro) problems.push(...allegro.problems);
    return {
      details: d,
      match,
      row: {
        productId: p.id,
        variantId: p.variantId!,
        sku: p.sku,
        name: d?.title ?? p.name,
        ean: p.ean,
        imageUrl: p.imageUrl,
        shopifyPrice: d?.price ?? null,
        price: d ? publishPrice(d.price, account.settings) : null,
        stock: p.stock,
        catalogue: !p.ean || !match ? null : !match.found ? 'missing' : match.unverified ? 'unverified' : 'found',
        problems,
        ...(allegro ? { allegro: allegro.preview } : {}),
      },
      gpsr: allegro ? { responsiblePersonId: allegro.responsiblePersonId, responsibleProducerId: allegro.responsibleProducerId } : {},
    };
  });
  if (account.type !== 'allegro') return { rows, setupProblems, settings: account.settings };
  // Products the catalogue doesn't know are proposed as new products, with a category and its parameters.
  const unknown = rows.filter((r) => r.details && r.match && !r.match.found).map((r) => Object.assign(r, { productType: r.details!.productType ?? '' }));
  const allegroNew = await prepareNewProducts(pub, account.settings, unknown);
  return { rows, setupProblems, settings: account.settings, allegroNew };
}

/** Shopify products that have no offer in this account yet, with what would be sent. */
export async function publishPreview(accountId: string): Promise<PublishPreview> {
  const { rows, setupProblems, allegroNew } = await loadRows(accountId);
  return { rows: rows.map((r) => r.row), setupProblems, ...(allegroNew ? { allegroNew } : {}) };
}

export interface PublishResult {
  created: string[];
  failed: { name: string; error: string }[];
  notes: string[];
}

/** Creates offers for the chosen products (only those that are ready), then imports the listings so stock can follow. */
export async function publishOffers(accountId: string, productIds: string[]): Promise<PublishResult> {
  if (productIds.length === 0) throw new Error(msg('Choose at least one product'));
  if (productIds.length > MAX_OFFERS_PER_RUN) throw new Error(`Create at most ${MAX_OFFERS_PER_RUN} offers at a time`);
  const account = await loadMarketplaceAccount(accountId);
  const pub = publisher(account);
  const { rows, setupProblems, settings } = await loadRows(accountId, new Set(productIds));
  if (setupProblems.length) throw new Error(`Finish the account settings first: ${setupProblems.join(', ')}`);

  const result: PublishResult = { created: [], failed: [], notes: [] };
  for (const { row, match, details, gpsr, newProduct } of rows) {
    if (row.problems.length || !details || !match) {
      result.failed.push({ name: row.name, error: `not ready: ${row.problems.join(', ') || 'missing data'}` });
      continue;
    }
    const draft: OfferDraft = {
      // Products without a SKU in Shopify carry a made-up one; the barcode identifies the offer instead.
      sku: hasRealSku(row.sku) ? row.sku : row.ean!,
      ean: row.ean!,
      name: details.title,
      descriptionHtml: details.descriptionHtml,
      brand: details.vendor,
      imageUrls: details.imageUrls.slice(0, 16),
      weightGrams: details.weightGrams,
      quantity: row.stock,
      price: row.price!,
      currency: 'PLN',
      extraFields: resolveOfferFields(settings, details.metafields).values,
      ...gpsr,
      ...(newProduct ? { allegroNewProduct: newProduct } : {}),
    };
    try {
      const done = await pub.createOffer(draft, match);
      result.created.push(row.name);
      if (done.note) result.notes.push(`${row.name}: ${done.note}`);
    } catch (err) {
      result.failed.push({ name: row.name, error: err instanceof Error ? err.message : String(err) });
    }
  }
  if (result.created.length) await importListings(accountId);
  return result;
}

const OPTIONS_TTL_MS = 6 * 3_600_000;
/** How old Allegro's list of responsible persons may be when products are matched to it. */
const GPSR_OPTIONS_TTL_MS = 10 * 60_000;

/** Allegro's shipping rates, return policies and warranties to choose from, read from Allegro and cached for a few hours. */
export async function loadAllegroOptions(accountId: string, force = false, maxAgeMs = OPTIONS_TTL_MS) {
  const account = await loadMarketplaceAccount(accountId);
  const cached = account.settings.allegroOptions;
  if (!force && cached && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) return cached;
  const adapter = getMarketplaceAdapter(account);
  if (!(adapter instanceof AllegroAdapter)) throw new Error(msg('This is not an Allegro account'));
  const options = { fetchedAt: new Date().toISOString(), ...(await adapter.publishOptions()) };
  await getDb()
    .update(marketplaceAccounts)
    .set({ settings: { ...account.settings, allegroOptions: options } })
    .where(eq(marketplaceAccounts.id, accountId));
  return options;
}

/** Remembers the Allegro category for new products of a Shopify product type; an empty id forgets it. */
export async function saveAllegroCategory(accountId: string, productType: string, category: { id: string; path: string } | null): Promise<void> {
  const account = await loadMarketplaceAccount(accountId);
  if (account.type !== 'allegro') throw new Error(msg('This is not an Allegro account'));
  const map = { ...(account.settings.allegroCategoryMap ?? {}) };
  if (category?.id.trim()) map[productType] = { id: category.id.trim(), path: category.path.trim() || category.id.trim() };
  else delete map[productType];
  await getDb().update(marketplaceAccounts).set({ settings: { ...account.settings, allegroCategoryMap: map } }).where(eq(marketplaceAccounts.id, accountId));
}

/** Where an Allegro product parameter's value comes from, by parameter name; both empty forgets it. */
export async function saveAllegroParameterSource(accountId: string, name: string, source: { metafield: string; fallback: string }): Promise<void> {
  const account = await loadMarketplaceAccount(accountId);
  if (account.type !== 'allegro') throw new Error(msg('This is not an Allegro account'));
  const key = name.trim();
  if (!key) throw new Error(msg('Name the parameter'));
  const sources = { ...(account.settings.allegroParameterSources ?? {}) };
  const metafield = source.metafield.trim();
  const fallback = source.fallback.trim();
  if (metafield || fallback) sources[key] = { ...(metafield ? { metafield } : {}), ...(fallback ? { fallback } : {}) };
  else delete sources[key];
  await getDb().update(marketplaceAccounts).set({ settings: { ...account.settings, allegroParameterSources: sources } }).where(eq(marketplaceAccounts.id, accountId));
}
