'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireAdmin } from '@/server/auth';
import { loadAllegroOptions, MAX_OFFERS_PER_RUN, publishOffers } from '@/server/services/marketplace-offers';

export async function createOffersAction(accountId: string, _prev: ActionResult, fd: FormData): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const ids = fd.getAll('productId').map(String);
    if (ids.length === 0) throw new Error('Tick the products to create first');
    if (ids.length > MAX_OFFERS_PER_RUN) throw new Error(`Create at most ${MAX_OFFERS_PER_RUN} offers at a time`);
    const { created, failed, notes } = await publishOffers(accountId, ids);
    revalidatePath(`/inventory/publish/${accountId}`);
    revalidatePath('/inventory');
    if (created.length === 0) throw new Error(failed.map((f) => `${f.name}: ${f.error}`).join(' | '));
    const tail = [...(failed.length ? [`Failed: ${failed.map((f) => `${f.name}: ${f.error}`).join(' | ')}`] : []), ...notes].join(' ');
    return `Created ${created.length} offer(s).${tail ? ` ${tail}` : ''}`;
  });
}

export async function loadAllegroOptionsAction(accountId: string): Promise<ActionResult> {
  await requireAdmin();
  return attempt(async () => {
    const o = await loadAllegroOptions(accountId, true);
    revalidatePath(`/settings/integrations/marketplace/${accountId}`);
    return `Loaded ${o.shippingRates.length} shipping rates, ${o.returnPolicies.length} return policies and ${o.impliedWarranties.length} warranty terms from Allegro`;
  });
}
