// Writes Luora's customer segments (and, optionally, staff tags) to Shopify customers as tags, so
// Shopify Email, Klaviyo and similar tools can target them. Only customers who bought on Shopify:
// Allegro and Empik forbid using their buyers' data for your own marketing.
import { and, eq } from 'drizzle-orm';
import { segmentCustomers, segmentTag, type SegmentKey } from '@/lib/crm/segments';
import { getDb } from '../db/client';
import { crmSettings, customers, marketplaceAccounts, type CrmSettings, type Customer } from '../db/schema';
import { isMockMode } from '../env';
import { ShopifyAdapter } from '../integrations/marketplaces/shopify/adapter';
import { enqueue, JOBS } from '../jobs/queue';
import { getMarketplaceAdapter } from './accounts';

export const DEFAULT_CRM_SETTINGS: Required<CrmSettings> = { syncSegments: [], syncManualTags: false, dryRun: true };

export async function loadCrmSettings(): Promise<Required<CrmSettings>> {
  const [row] = await getDb().select().from(crmSettings).where(eq(crmSettings.id, 'main'));
  return { ...DEFAULT_CRM_SETTINGS, ...row?.settings };
}

export async function saveCrmSettings(settings: CrmSettings): Promise<void> {
  await getDb()
    .insert(crmSettings)
    .values({ id: 'main', settings })
    .onConflictDoUpdate({ target: crmSettings.id, set: { settings, updatedAt: new Date() } });
}

/** What the sync needs from Shopify; the demo mode and tests use a fake. */
export interface ShopifyCustomerApi {
  findCustomer(email: string): Promise<{ id: string; tags: string[]; subscribed: boolean } | null>;
  updateCustomerTags(customerId: string, add: string[], remove: string[]): Promise<void>;
}

const holder = globalThis as unknown as { __luoraShopifyCustomers?: ShopifyCustomerApi };

/** Tests and demo mode: replace Shopify with an in-memory fake. */
export function setShopifyCustomerApi(api: ShopifyCustomerApi | undefined): void {
  holder.__luoraShopifyCustomers = api;
}

async function shopifyApi(): Promise<ShopifyCustomerApi | null> {
  if (holder.__luoraShopifyCustomers) return holder.__luoraShopifyCustomers;
  if (isMockMode()) return null;
  const [account] = await getDb()
    .select()
    .from(marketplaceAccounts)
    .where(and(eq(marketplaceAccounts.type, 'shopify'), eq(marketplaceAccounts.enabled, true)));
  const adapter = account ? getMarketplaceAdapter(account) : null;
  return adapter instanceof ShopifyAdapter ? adapter : null;
}

/** The Luora tags a customer should carry in Shopify. */
export function desiredTags(customer: Pick<Customer, 'tags'>, segment: SegmentKey | undefined, settings: Required<CrmSettings>): string[] {
  const tags = new Set<string>();
  if (segment && settings.syncSegments.includes(segment)) tags.add(segmentTag(segment));
  if (settings.syncManualTags) for (const t of customer.tags) tags.add(t);
  return [...tags].sort();
}

export interface CrmSyncResult {
  /** Customers whose tags differ from what Shopify has. */
  changes: number;
  updated: number;
  notFound: number;
  dryRun: boolean;
  errors: string[];
}

const PER_RUN = 150;

/** Shopify customers whose Luora tags differ from what was last written to Shopify. */
export async function pendingTagChanges(settings: Required<CrmSettings>) {
  const all = await getDb().select().from(customers);
  const segments = segmentCustomers(all);
  return all
    .filter((c) => c.email && c.marketplaces.includes('shopify'))
    .map((c) => {
      const want = desiredTags(c, segments.get(c.id)?.segment, settings);
      const had = c.syncedTags ?? [];
      return { c, want, add: want.filter((t) => !had.includes(t)), remove: had.filter((t) => !want.includes(t)) };
    })
    .filter((p) => p.add.length || p.remove.length);
}

export async function runCrmSync(): Promise<CrmSyncResult> {
  const db = getDb();
  const settings = await loadCrmSettings();
  const result: CrmSyncResult = { changes: 0, updated: 0, notFound: 0, dryRun: settings.dryRun, errors: [] };
  const pending = await pendingTagChanges(settings);
  result.changes = pending.length;
  if (settings.dryRun || !pending.length) return result;

  const api = await shopifyApi();
  if (!api) {
    result.errors.push('No Shopify account is connected');
    return result;
  }
  for (const p of pending.slice(0, PER_RUN)) {
    try {
      let shopifyId = p.c.shopifyCustomerId;
      let consent = p.c.marketingConsent;
      if (!shopifyId) {
        const found = await api.findCustomer(p.c.email!);
        if (!found) {
          result.notFound++;
          continue;
        }
        shopifyId = found.id;
        consent = found.subscribed;
      }
      await api.updateCustomerTags(shopifyId, p.add, p.remove);
      await db
        .update(customers)
        .set({ shopifyCustomerId: shopifyId, marketingConsent: consent, syncedTags: p.want, syncedAt: new Date() })
        .where(eq(customers.id, p.c.id));
      result.updated++;
    } catch (err) {
      result.errors.push(`${p.c.displayName}: ${err instanceof Error ? err.message : String(err)}`);
      if (result.errors.length >= 5) break;
    }
  }
  if (pending.length > PER_RUN && result.errors.length < 5) await enqueue(JOBS.crmSync, {}, { debounceSeconds: 10, singletonKey: 'continue' });
  return result;
}
