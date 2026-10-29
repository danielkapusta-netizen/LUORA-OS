'use server';

import { revalidatePath } from 'next/cache';
import { attempt, type ActionResult } from '@/lib/action-result';
import { assertCapability } from '@/server/auth';
import { enqueue, JOBS } from '@/server/jobs/queue';
import { listMarketplaceAccounts } from '@/server/services/settings';
import { isPricePlatform, pushPrices, PRICE_PLATFORM_LABEL } from '@/server/services/pricing';
import { msg } from '@/lib/i18n/msg';
import { getT } from '@/lib/i18n/server';

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
    const label = isPricePlatform(platform) ? PRICE_PLATFORM_LABEL[platform] : (await getT())('the platform');
    const { updated, unchanged, failed } = await pushPrices(requests);
    revalidatePath('/pricing');
    const problems = failed.map((f) => `${f.title}: ${f.message}`).join(' | ');
    if (updated === 0 && failed.length) throw new Error(problems);
    if (updated === 0) {
      const t = await getT();
      return unchanged ? t('Those prices are already on {platform}', { platform: label }) : t('No price changed');
    }
    const t = await getT();
    return `${t.plural(updated, 'Sent {n} price to {platform}.', 'Sent {n} prices to {platform}.', { platform: label })}${failed.length ? ` ${t('Not sent:')} ${problems}` : ''}`;
  });
}

/** Re-reads the prices from the platform, e.g. after they were changed there directly. */
export async function refreshPricesAction(platform: string): Promise<ActionResult> {
  await assertCapability('pricing');
  return attempt(async () => {
    const accounts = (await listMarketplaceAccounts()).filter((a) => a.enabled && a.type === platform);
    if (accounts.length === 0) throw new Error(msg('This platform has no connected account'));
    for (const a of accounts) await enqueue(JOBS.listingsImport, { accountId: a.id }, { singletonKey: a.id });
    return msg('Reading the prices again. Refresh the page in a moment.');
  });
}
