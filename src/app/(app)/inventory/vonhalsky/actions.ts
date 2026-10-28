'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin } from '@/server/auth';
import { createOffers, loadCategories, saveCategoryChoice, syncOfferPrices } from '@/server/services/vonhalsky-offers';
import { msg } from '@/lib/i18n/msg';
import { getT } from '@/lib/i18n/server';

const PAGE = '/inventory/vonhalsky';

export async function loadCategoriesAction(accountId: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const items = await loadCategories(accountId, true);
    revalidatePath(PAGE);
    return (await getT())('Loaded {n} categories from InPost', { n: items.length });
  });
}

export async function saveCategoryAction(accountId: string, productType: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const categoryId = String(fd.get('categoryId') ?? '');
    if (!categoryId) throw new Error(msg('Choose a category'));
    await saveCategoryChoice(accountId, productType, categoryId);
    revalidatePath(PAGE);
    return msg('Category saved');
  });
}

export async function createOffersAction(accountId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const ids = fd.getAll('productId').map(String);
    if (ids.length === 0) throw new Error(msg('Tick the products to create first'));
    if (ids.length > 25) throw new Error(msg('Create at most 25 offers at a time'));
    const { created, failed } = await createOffers(accountId, ids);
    revalidatePath(PAGE);
    revalidatePath('/inventory');
    if (created.length === 0) throw new Error(failed.map((f) => `${f.name}: ${f.error}`).join(' | '));
    const t = await getT();
    const note = failed.length ? ` ${t('Failed:')} ${failed.map((f) => `${f.name}: ${f.error}`).join(' | ')}` : '';
    return `${t.plural(created.length, 'Created {n} offer in Von Halsky.', 'Created {n} offers in Von Halsky.')}${note}`;
  });
}

export async function syncPricesAction(accountId: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const { updated } = await syncOfferPrices(accountId);
    revalidatePath(PAGE);
    return updated ? `Updated ${updated} price(s)` : 'All prices are already up to date';
  });
}
