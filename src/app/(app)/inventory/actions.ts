'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { requireUser } from '@/server/auth';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { adjustStock, confirmClearSuggestions, linkGroup, linkListing, setListingStock } from '@/server/services/inventory';
import { listMarketplaceAccounts } from '@/server/services/settings';

export async function adjustStockAction(productId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const mode = formData.get('mode') === 'add' ? 'add' : 'set';
  const value = Number(formData.get('value'));
  return attempt(async () => {
    if (!Number.isInteger(value)) throw new Error('Enter a whole number');
    await adjustStock({ productId, mode, value, userId: user.id, note: String(formData.get('note') ?? '') });
    revalidatePath('/inventory');
    return 'Stock updated; marketplaces will follow shortly';
  });
}

/** Links every offer of a group (the same barcode on Allegro and Empik) to the chosen Shopify product. */
export async function linkGroupAction(listingIds: string[], _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const productId = String(formData.get('productId') ?? '');
    if (!productId) throw new Error('Choose the Shopify product first');
    await linkGroup(listingIds, productId);
    revalidatePath('/inventory');
    return 'Linked';
  });
}

export async function unlinkListingAction(listingId: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await linkListing(listingId, null);
    revalidatePath('/inventory');
    return 'Unlinked; it is back under “Needs matching”';
  });
}

export async function confirmClearSuggestionsAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const linked = await confirmClearSuggestions();
    revalidatePath('/inventory');
    return `Linked ${linked} listing(s)`;
  });
}

export async function importListingsAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled);
    for (const a of accounts) await enqueue(JOBS.listingsImport, { accountId: a.id }, { singletonKey: a.id });
    return `Importing listings from ${accounts.length} account(s). Refresh in a moment.`;
  });
}

export async function syncAllStockAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled);
    await enqueue(JOBS.stockSyncAll, {});
    const off = accounts.filter((a) => !a.stockSyncEnabled).map((a) => a.name);
    const dry = accounts.filter((a) => a.stockSyncEnabled && a.stockDryRun).map((a) => a.name);
    const live = accounts.filter((a) => a.stockSyncEnabled && !a.stockDryRun).map((a) => a.name);
    return [
      live.length ? `Re-reading every platform and sending stock to ${live.join(', ')}.` : 'Re-reading every platform, but nothing is sent:',
      dry.length ? `${dry.join(', ')} ${dry.length > 1 ? 'are' : 'is'} in dry run (only logged); switch it off in Settings → Integrations to really send.` : '',
      off.length ? `Stock sync is off for ${off.join(', ')}.` : '',
    ]
      .filter(Boolean)
      .join(' ');
  });
}

/** What one listing is sent: the master stock, a fixed quantity, or nothing (managed on the marketplace itself). */
export async function setListingStockAction(listingId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  const choice = String(formData.get('mode') ?? 'master');
  const mode = choice === 'fixed' || choice === 'off' ? choice : 'master';
  return attempt(async () => {
    const raw = String(formData.get('qty') ?? '').trim();
    await setListingStock(listingId, mode, mode === 'fixed' ? (raw === '' ? null : Number(raw)) : null);
    revalidatePath('/inventory');
    return mode === 'master' ? 'Follows the master stock' : mode === 'off' ? 'Not sent any more' : 'Fixed quantity saved';
  });
}
