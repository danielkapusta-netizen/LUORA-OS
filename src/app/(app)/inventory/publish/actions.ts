'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin } from '@/server/auth';
import { importListings } from '@/server/services/inventory';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { loadAllegroOptions, MAX_OFFERS_PER_RUN, publishOffers, saveAllegroCategory, saveAllegroParameterSource } from '@/server/services/marketplace-offers';
import { msg } from '@/lib/i18n/msg';
import { getT } from '@/lib/i18n/server';

export async function createOffersAction(accountId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const ids = fd.getAll('productId').map(String);
    if (ids.length === 0) throw new Error(msg('Tick the products to create first'));
    if (ids.length > MAX_OFFERS_PER_RUN) throw new Error(`Create at most ${MAX_OFFERS_PER_RUN} offers at a time`);
    const { created, failed, notes } = await publishOffers(accountId, ids);
    revalidatePath(`/inventory/publish/${accountId}`);
    revalidatePath('/inventory');
    if (created.length === 0) throw new Error(failed.map((f) => `${f.name}: ${f.error}`).join(' | '));
    const t = await getT();
    const tail = [...(failed.length ? [`${t('Failed:')} ${failed.map((f) => `${f.name}: ${f.error}`).join(' | ')}`] : []), ...notes].join(' ');
    return `${t.plural(created.length, 'Created {n} offer.', 'Created {n} offers.')}${tail ? ` ${tail}` : ''}`;
  });
}

export async function loadAllegroOptionsAction(accountId: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const o = await loadAllegroOptions(accountId, true);
    revalidatePath(`/settings/integrations/marketplace/${accountId}`);
    return (await getT())('Loaded {rates} shipping rates, {policies} return policies and {warranties} warranty terms from Allegro', { rates: o.shippingRates.length, policies: o.returnPolicies.length, warranties: o.impliedWarranties.length });
  });
}

/** Reads the products, titles and barcodes from Shopify again, so what was just typed there shows at once. */
export async function refreshFromShopifyAction(accountId: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const shopify = (await listMarketplaceAccounts()).find((a) => a.type === 'shopify' && a.enabled);
    if (!shopify) throw new Error(msg('There is no Shopify account'));
    const { listings, created } = await importListings(shopify.id);
    revalidatePath(`/inventory/publish/${accountId}`);
    revalidatePath('/inventory');
    return (await getT())('Read {listings} products from Shopify ({created} new)', { listings, created });
  });
}

/** Saves the Allegro category for new products of one Shopify product type: a typed id wins over the chosen suggestion. */
export async function saveAllegroCategoryAction(accountId: string, productType: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const typed = String(fd.get('categoryIdTyped') ?? '').trim();
    const [id, ...path] = String(fd.get('category') ?? '').split('|');
    if (typed && !/^\d+$/.test(typed)) throw new Error(msg('An Allegro category id is a number, e.g. 257689'));
    await saveAllegroCategory(accountId, productType, typed ? { id: typed, path: `#${typed}` } : id ? { id, path: path.join('|') } : null);
    revalidatePath(`/inventory/publish/${accountId}`);
    return msg('Saved');
  });
}

/** Saves where one Allegro product parameter is read from (Shopify metafield, else a fixed value). */
export async function saveAllegroParameterAction(accountId: string, name: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const metafield = String(fd.get('metafield') ?? '').trim();
    if (metafield && !metafield.split(',').every((k) => /^[\w-]+\.[\w-]+$/.test(k.trim()))) throw new Error(msg('Write the metafield as namespace.key, e.g. custom.capacity'));
    await saveAllegroParameterSource(accountId, name, { metafield, fallback: String(fd.get('fallback') ?? '') });
    revalidatePath(`/inventory/publish/${accountId}`);
    return msg('Saved');
  });
}
