'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { assertCapability } from '@/server/auth';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { isPricePlatform, pushPrices, PRICE_PLATFORM_LABEL } from '@/server/services/pricing';
import { msg } from '@/lib/i18n/msg';

const FIELD = 'price:';

/**
 * Sends the prices typed on the page to the platform. The "only" button of a row sends just that
 * row; the top button sends every price on the page that differs from what the platform has.
 */
export async function pushPricesAction(platform: string, _prev: ActionResult, formData: FormData): Promise<ActionResult> {
  await assertCapability('pricing');
  return attempt(async () => {
    const only = formData.get('only');
    const requests = [...formData.entries()]
      .flatMap(([key, value]) => (key.startsWith(FIELD) && typeof value === 'string' && value.trim() !== '' ? [{ listingId: key.slice(FIELD.length), price: value }] : []))
      .filter((r) => !only || r.listingId === only);
    if (requests.length === 0) throw new Error(msg('Type a new price first'));
    const label = isPricePlatform(platform) ? PRICE_PLATFORM_LABEL[platform] : 'the platform';
    const { updated, unchanged, failed } = await pushPrices(requests);
    revalidatePath('/pricing');
    const problems = failed.map((f) => `${f.title}: ${f.message}`).join(' | ');
    if (updated === 0 && failed.length) throw new Error(problems);
    if (updated === 0) return unchanged ? 'Those prices are already on ' + label : 'No price changed';
    return `Sent ${updated} price${updated === 1 ? '' : 's'} to ${label}.${failed.length ? ` Not sent: ${problems}` : ''}`;
  });
}

/** Re-reads the prices from the platform, e.g. after they were changed there directly. */
export async function refreshPricesAction(platform: string): Promise<ActionResult> {
  await assertCapability('pricing');
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled && a.type === platform);
    if (accounts.length === 0) throw new Error(msg('This platform has no connected account'));
    for (const a of accounts) await enqueue(JOBS.listingsImport, { accountId: a.id }, { singletonKey: a.id });
    return 'Reading the prices again. Refresh the page in a moment.';
  });
}
