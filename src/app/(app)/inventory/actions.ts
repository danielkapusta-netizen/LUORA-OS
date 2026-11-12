'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { eq } from 'drizzle-orm';
import { requireAdmin, requireUser } from '@/server/auth';
import { getDb } from '@/server/db/client';
import { marketplaceAccounts } from '@/server/db/schema';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { loadMarketplaceAccount } from '@/server/services/accounts';
import { activateListing, adjustStock, adoptMarketplaceStock, confirmClearSuggestions, importListings, linkGroup, linkListing, setListingStock } from '@/server/services/inventory';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { startSyncRun } from '@/server/services/stock-sync';
import { msg } from '@/lib/i18n/msg';
import { getT } from '@/lib/i18n/server';

export async function adjustStockAction(productId: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const user = await requireUser();
  const mode = formData.get('mode') === 'add' ? 'add' : 'set';
  const value = Number(formData.get('value'));
  return attempt(async () => {
    if (!Number.isInteger(value)) throw new Error(msg('Enter a whole number'));
    await adjustStock({ productId, mode, value, userId: user.id, note: String(formData.get('note') ?? '') });
    revalidatePath('/inventory');
    return msg('Stock updated; marketplaces will follow shortly');
  });
}

/** Links every offer of a group (the same barcode on Allegro and Empik) to the chosen Shopify product. */
export async function linkGroupAction(listingIds: string[], _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const productId = String(formData.get('productId') ?? '');
    if (!productId) throw new Error(msg('Choose the Shopify product first'));
    await linkGroup(listingIds, productId);
    revalidatePath('/inventory');
    return msg('Linked');
  });
}

export async function unlinkListingAction(listingId: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    await linkListing(listingId, null);
    revalidatePath('/inventory');
    return msg('Unlinked; it is back under “Needs matching”');
  });
}

export async function confirmClearSuggestionsAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const linked = await confirmClearSuggestions();
    revalidatePath('/inventory');
    return (await getT()).plural(linked, 'Linked {n} listing', 'Linked {n} listings');
  });
}

export async function importListingsAction(): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled);
    for (const a of accounts) await enqueue(JOBS.listingsImport, { accountId: a.id }, { singletonKey: a.id });
    return (await getT()).plural(accounts.length, 'Importing listings from {n} account. Refresh in a moment.', 'Importing listings from {n} accounts. Refresh in a moment.');
  });
}

/** "Update all stock": every marketplace is read, sent the stock it should show, and read again to check. */
export async function syncAllStockAction(): Promise<ActionResult> {
  const user = await requireUser();
  return attempt(async () => {
    const { started } = await startSyncRun('manual', user.id);
    revalidatePath('/inventory');
    return started ? msg('Update started: every marketplace is read, sent its stock and checked.') : msg('An update is already running.');
  });
}

/** Puts one off-sale offer back on sale with the stock it should show, and says what the marketplace answered. */
export async function activateListingAction(listingId: string): Promise<ActionResult> {
  await requireUser();
  return attempt(async () => {
    let result: Awaited<ReturnType<typeof activateListing>>;
    try {
      result = await activateListing(listingId);
    } finally {
      revalidatePath('/inventory');
    }
    const t = await getT();
    if (result.onSale) return t('On sale on {account} with {n} in stock', { account: result.accountName, n: result.quantity });
    throw new Error(
      t('{account} was sent {n}, but still shows the offer off sale{status}. If it stays off, put it on sale in the marketplace’s own panel.', {
        account: result.accountName,
        n: result.quantity,
        status: result.status ? ` (${result.status.toLowerCase()})` : '',
      }),
    );
  });
}

/**
 * Takes the marketplace's number as the stock: of one product, or (admins) of every product where the two differ.
 * The marketplace is read first, so the number taken is the one it shows now.
 */
export async function adoptStockAction(accountId: string, productId: string | null): Promise<ActionResult> {
  const user = productId ? await requireUser() : await requireAdmin();
  return attempt(async () => {
    const account = await loadMarketplaceAccount(accountId);
    await importListings(accountId);
    const changed = await adoptMarketplaceStock({ accountId, productIds: productId ? [productId] : undefined, userId: user.id });
    revalidatePath('/inventory');
    const t = await getT();
    if (changed === 0) return t('Stock already matches {account}', { account: account.name });
    return t.plural(changed, 'Stock of {n} product now matches {account}', 'Stock of {n} products now match {account}', { account: account.name });
  });
}

/** Ends the review of an account: from now on stock is really sent to it, starting with a full update. */
export async function goLiveAction(accountId: string): Promise<ActionResult> {
  const user = await requireAdmin();
  return attempt(async () => {
    const account = await loadMarketplaceAccount(accountId);
    await getDb().update(marketplaceAccounts).set({ stockSyncEnabled: true, stockDryRun: false }).where(eq(marketplaceAccounts.id, accountId));
    await startSyncRun('manual', user.id);
    revalidatePath('/inventory');
    const t = await getT();
    return t('Stock is now sent to {account}. A full update has started.', { account: account.name });
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
