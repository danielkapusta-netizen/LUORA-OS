import { httpConfig, HttpError, request } from '../../../http';
import type { CredentialsStore } from '../../types';
import { msg } from '@/lib/i18n/msg';

export interface ShopifyCredentials {
  /** e.g. "my-shop.myshopify.com" */
  shopDomain: string;
  /** Dev Dashboard app credentials (client credentials grant). */
  clientId?: string;
  clientSecret?: string;
  /** Cached client-credentials token, or a legacy custom-app token (shpat_…). */
  accessToken?: string;
  /** ISO date; absent for legacy tokens, which never expire. */
  tokenExpiresAt?: string | null;
}

export const DEFAULT_SHOPIFY_API_VERSION = '2026-07';

interface GraphqlResponse<T> {
  data?: T;
  errors?: { message: string; extensions?: { code?: string } }[];
}

export class ShopifyGraphqlError extends Error {
  constructor(readonly messages: string[]) {
    super(`Shopify GraphQL error: ${messages.join('; ')}`);
  }
}

export class ShopifyClient {
  constructor(
    private readonly creds: CredentialsStore<ShopifyCredentials>,
    private readonly apiVersion = DEFAULT_SHOPIFY_API_VERSION,
  ) {}

  private get shop(): string {
    return this.creds.get().shopDomain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }

  private usesClientCredentials(): boolean {
    const c = this.creds.get();
    return Boolean(c.clientId && c.clientSecret);
  }

  /** Returns a valid Admin API token, fetching a new one shortly before the old one expires. */
  async accessToken(forceRefresh = false): Promise<string> {
    const c = this.creds.get();
    if (!this.usesClientCredentials()) {
      if (!c.accessToken) throw new Error(msg('Shopify account has neither client credentials nor an access token'));
      return c.accessToken;
    }
    const expiresAt = c.tokenExpiresAt ? Date.parse(c.tokenExpiresAt) : 0;
    if (!forceRefresh && c.accessToken && expiresAt - Date.now() > 5 * 60_000) return c.accessToken;

    const { data } = await request<{ access_token: string; expires_in?: number }>(
      `https://${this.shop}/admin/oauth/access_token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: c.clientId!,
          client_secret: c.clientSecret!,
        }),
      },
    );
    const next: ShopifyCredentials = {
      ...c,
      accessToken: data.access_token,
      tokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 86_399) * 1000).toISOString(),
    };
    await this.creds.save(next);
    return next.accessToken!;
  }

  async graphql<T>(query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let refreshed = false;
    for (let attempt = 0; ; attempt++) {
      const token = await this.accessToken();
      let response: GraphqlResponse<T>;
      try {
        ({ data: response } = await request<GraphqlResponse<T>>(
          `https://${this.shop}/admin/api/${this.apiVersion}/graphql.json`,
          {
            method: 'POST',
            headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
            body: { query, variables },
          },
        ));
      } catch (err) {
        if (err instanceof HttpError && err.status === 401 && this.usesClientCredentials() && !refreshed) {
          refreshed = true;
          await this.accessToken(true);
          continue;
        }
        throw err;
      }

      const throttled = response.errors?.some((e) => e.extensions?.code === 'THROTTLED');
      if (throttled && attempt < 5) {
        await httpConfig.sleep(1000 * (attempt + 1));
        continue;
      }
      if (response.errors?.length) throw new ShopifyGraphqlError(response.errors.map((e) => e.message));
      if (!response.data) throw new ShopifyGraphqlError(['empty response']);
      return response.data;
    }
  }
}
