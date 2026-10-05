// InPost Von Halsky merchant API (https://inpsa-api-portal.inpost-group.com): OAuth2 client
// credentials, JSON over HTTPS, everything inside the merchant organisation's path.
import { HttpError, request, type RequestOptions } from '../../../http';
import type { CredentialsStore } from '../../types';

export interface VonHalskyCredentials {
  /** The organisation (brand) created for this integration in the InPost Merchant Portal. */
  organizationId: string;
  clientId: string;
  clientSecret: string;
  /** Use InPost's stage environment instead of production. */
  sandbox?: boolean;
  accessToken?: string;
  /** ISO date */
  expiresAt?: string;
}

/** The scopes the five permissions of the Merchant Portal application stand for. */
export const VON_HALSKY_SCOPES = 'openid api:categories:read api:offers:read api:offers:write api:orders:read api:orders:write';

export function vonHalskyHosts(sandbox?: boolean) {
  return sandbox
    ? { api: 'https://stage-api.inpost-group.com/inpsa', token: 'https://stage-account.inpost-group.com/oauth2/token' }
    : { api: 'https://api.inpost-group.com/inpsa', token: 'https://account.inpost-group.com/oauth2/token' };
}

/** An API error with the reason InPost gave ({ errorCode, errorMessage, details }), readable for staff. */
export class VonHalskyApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'VonHalskyApiError';
  }
}

interface ErrorBody {
  errorCode?: string;
  errorMessage?: string;
  details?: { field?: string; detail?: string }[];
  error?: string;
  error_description?: string;
}

export function describeVonHalskyError(err: unknown): unknown {
  if (!(err instanceof HttpError)) return err;
  try {
    const body = JSON.parse(err.body) as ErrorBody;
    const details = (body.details ?? []).map((d) => [d.field, d.detail].filter(Boolean).join(': ')).filter(Boolean);
    const message = body.errorMessage ?? body.error_description ?? body.error;
    if (message) {
      return new VonHalskyApiError(err.status, `InPost Von Halsky (HTTP ${err.status}${body.errorCode ? ` ${body.errorCode}` : ''}): ${message}${details.length ? ` (${details.join('; ')})` : ''}`);
    }
  } catch {
    // Not JSON: keep the original error.
  }
  return err;
}

/** Refresh a token this long before it expires. */
const TOKEN_MARGIN_MS = 60_000;

interface TokenResponse {
  access_token: string;
  expires_in: number;
}

export class VonHalskyClient {
  constructor(private readonly creds: CredentialsStore<VonHalskyCredentials>) {}

  get organizationId(): string {
    return this.creds.get().organizationId;
  }

  private get apiBase(): string {
    return vonHalskyHosts(this.creds.get().sandbox).api;
  }

  /** Path inside the merchant's organisation, e.g. org('/orders') → /v1/organizations/{id}/orders. */
  org(rest: string): string {
    return `/v1/organizations/${encodeURIComponent(this.organizationId)}${rest}`;
  }

  private async fetchToken(): Promise<VonHalskyCredentials> {
    const c = this.creds.get();
    const url = vonHalskyHosts(c.sandbox).token;
    const body = { grant_type: 'client_credentials', scope: VON_HALSKY_SCOPES };
    const basic = Buffer.from(`${encodeURIComponent(c.clientId)}:${encodeURIComponent(c.clientSecret)}`).toString('base64');
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    let data: TokenResponse;
    try {
      ({ data } = await request<TokenResponse>(url, { method: 'POST', headers: { ...headers, Authorization: `Basic ${basic}` }, body: new URLSearchParams(body), retries: 1 }));
    } catch (err) {
      // Some servers want the client id and secret in the form body instead of a Basic header.
      if (!(err instanceof HttpError) || ![400, 401].includes(err.status)) throw describeVonHalskyError(err);
      try {
        ({ data } = await request<TokenResponse>(url, {
          method: 'POST',
          headers,
          body: new URLSearchParams({ ...body, client_id: c.clientId, client_secret: c.clientSecret }),
          retries: 1,
        }));
      } catch (second) {
        throw describeVonHalskyError(second);
      }
    }
    return { ...c, accessToken: data.access_token, expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString() };
  }

  private async accessToken(forceRefresh = false): Promise<string> {
    const c = this.creds.get();
    const valid = c.accessToken && c.expiresAt && new Date(c.expiresAt).getTime() - Date.now() > TOKEN_MARGIN_MS;
    if (valid && !forceRefresh) return c.accessToken!;
    const next = await this.fetchToken();
    await this.creds.save(next);
    return next.accessToken!;
  }

  async call<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    let refreshed = false;
    for (;;) {
      const token = await this.accessToken(refreshed);
      try {
        const { data } = await request<T>(`${this.apiBase}${path}`, {
          ...options,
          method,
          headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Accept-Language': 'en', ...options.headers },
          // A write that was retried could be applied twice.
          retries: options.retries ?? (method === 'GET' ? 3 : 0),
        });
        return data;
      } catch (err) {
        if (err instanceof HttpError && err.status === 401 && !refreshed) {
          refreshed = true;
          continue;
        }
        throw describeVonHalskyError(err);
      }
    }
  }
}
