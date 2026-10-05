// Loads accounts, decrypts their credentials and builds the matching adapter.
import { eq } from 'drizzle-orm';
import { decryptJson, encryptJson } from '../crypto';
import { getDb } from '../db/client';
import { carrierAccounts, marketplaceAccounts, type CarrierAccount, type MarketplaceAccount } from '../db/schema';
import { isMockMode } from '../env';
import { AllegroShippingAdapter } from '../integrations/carriers/allegro-shipping/adapter';
import { InpostAdapter, type InpostCredentials } from '../integrations/carriers/inpost/adapter';
import { MockCarrierAdapter } from '../integrations/carriers/mock/adapter';
import type { CarrierAdapter } from '../integrations/carriers/types';
import { AllegroAdapter } from '../integrations/marketplaces/allegro/adapter';
import { AllegroClient, type AllegroCredentials } from '../integrations/marketplaces/allegro/client';
import { EmpikAdapter } from '../integrations/marketplaces/empik/adapter';
import type { EmpikCredentials } from '../integrations/marketplaces/empik/client';
import { MockMarketplaceAdapter } from '../integrations/marketplaces/mock/adapter';
import { VonHalskyAdapter } from '../integrations/marketplaces/vonhalsky/adapter';
import type { VonHalskyCredentials } from '../integrations/marketplaces/vonhalsky/client';
import { ShopifyAdapter } from '../integrations/marketplaces/shopify/adapter';
import type { ShopifyCredentials } from '../integrations/marketplaces/shopify/client';
import type { MarketplaceAdapter } from '../integrations/marketplaces/types';
import type { CredentialsStore } from '../integrations/types';

export function readCredentials<T>(encrypted: string | null): T | null {
  return encrypted ? decryptJson<T>(encrypted) : null;
}

/** Credentials held in memory, written back (encrypted) whenever a token is refreshed. */
function marketplaceCredentialStore<T>(account: MarketplaceAccount): CredentialsStore<T> {
  let current = readCredentials<T>(account.credentials);
  if (!current) throw new Error(`${account.name} has no credentials yet. Add them in Settings → Integrations.`);
  return {
    get: () => current!,
    save: async (next) => {
      current = next;
      await getDb()
        .update(marketplaceAccounts)
        .set({ credentials: encryptJson(next) })
        .where(eq(marketplaceAccounts.id, account.id));
    },
  };
}

export function getMarketplaceAdapter(account: MarketplaceAccount): MarketplaceAdapter {
  if (isMockMode()) return new MockMarketplaceAdapter(account.type, account.id);
  switch (account.type) {
    case 'shopify':
      return new ShopifyAdapter(marketplaceCredentialStore<ShopifyCredentials>(account), account.settings);
    case 'allegro':
      return new AllegroAdapter(marketplaceCredentialStore<AllegroCredentials>(account), account.settings);
    case 'vonhalsky':
      return new VonHalskyAdapter(marketplaceCredentialStore<VonHalskyCredentials>(account), account.settings);
    case 'empik': {
      const creds = readCredentials<EmpikCredentials>(account.credentials);
      if (!creds) throw new Error(`${account.name} has no API key yet. Add it in Settings → Integrations.`);
      return new EmpikAdapter(creds, account.settings, async (next) => {
        // Only the carrier cache changes here; merge into fresh settings so a concurrent edit isn't lost.
        const fresh = await loadMarketplaceAccount(account.id);
        await getDb()
          .update(marketplaceAccounts)
          .set({ settings: { ...fresh.settings, carrierCache: next.carrierCache } })
          .where(eq(marketplaceAccounts.id, account.id));
      });
    }
  }
}

export async function getCarrierAdapter(account: CarrierAccount): Promise<CarrierAdapter> {
  if (isMockMode()) return new MockCarrierAdapter(account.type);
  switch (account.type) {
    case 'inpost': {
      const creds = readCredentials<InpostCredentials>(account.credentials);
      if (!creds) throw new Error(`${account.name} has no API token yet. Add it in Settings → Integrations.`);
      return new InpostAdapter(creds, account.settings);
    }
    case 'allegro_shipping': {
      if (!account.marketplaceAccountId) throw new Error(`${account.name} is not linked to an Allegro account`);
      const allegro = await loadMarketplaceAccount(account.marketplaceAccountId);
      return new AllegroShippingAdapter(new AllegroClient(marketplaceCredentialStore<AllegroCredentials>(allegro)), account.settings);
    }
  }
}

export async function loadMarketplaceAccount(id: string): Promise<MarketplaceAccount> {
  const [account] = await getDb().select().from(marketplaceAccounts).where(eq(marketplaceAccounts.id, id));
  if (!account) throw new Error(`Marketplace account ${id} not found`);
  return account;
}

export async function loadCarrierAccount(id: string): Promise<CarrierAccount> {
  const [account] = await getDb().select().from(carrierAccounts).where(eq(carrierAccounts.id, id));
  if (!account) throw new Error(`Carrier account ${id} not found`);
  return account;
}

/** Adds `configured`: whether the carrier has what it needs to buy labels (always true in demo mode). */
export async function withConfigured<T extends CarrierAccount>(carriers: T[]): Promise<(T & { configured: boolean })[]> {
  if (isMockMode()) return carriers.map((c) => ({ ...c, configured: true }));
  const allegro = await getDb().select().from(marketplaceAccounts).where(eq(marketplaceAccounts.type, 'allegro'));
  const connected = new Set(allegro.filter((a) => readCredentials<AllegroCredentials>(a.credentials)?.refreshToken).map((a) => a.id));
  return carriers.map((c) => {
    if (c.type === 'inpost') {
      const creds = readCredentials<InpostCredentials>(c.credentials);
      return { ...c, configured: Boolean(creds?.apiToken && creds.organizationId) };
    }
    return { ...c, configured: Boolean(c.marketplaceAccountId && connected.has(c.marketplaceAccountId)) };
  });
}
