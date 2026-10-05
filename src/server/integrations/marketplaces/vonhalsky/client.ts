// InPost Von Halsky merchant API (https://inpsa-api-portal.inpost-group.com): OAuth2 client
// credentials, JSON over HTTPS, everything inside the merchant organisation's path.
import { createHash, randomBytes } from 'node:crypto';
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
  /** Set after "Connect Von Halsky" (Authorization Code flow); valid 30 days, replaced on every refresh. */
  refreshToken?: string;
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

/** Register exactly this path (prefixed with the app's URL) as a redirect URL of the Merchant Portal application. */
export const VON_HALSKY_REDIRECT_PATH = '/api/oauth/vonhalsky/callback';

const base64url = (bytes: Buffer) => bytes.toString('base64url');

/** PKCE: a random verifier and its S256 challenge. */
export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32));
  return { verifier, challenge: base64url(createHash('sha256').update(verifier).digest()) };
}

export function vonHalskyAuthorizeUrl(creds: Pick<VonHalskyCredentials, 'clientId' | 'sandbox'>, redirectUri: string, state: string, challenge: string): string {
  const url = new URL(vonHalskyHosts(creds.sandbox).token.replace(/\/token$/, '/authorize'));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', VON_HALSKY_SCOPES);
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
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
  refresh_token?: string;
  expires_in: number;
}

/**
 * Posts to the token endpoint. Servers differ in how a client proves itself, so the variants in
 * `order` are tried until one is accepted: "basic" (secret in an Authorization header), "body"
 * (secret in the form) and "public" (only the client id, which PKCE makes sufficient).
 */
async function postToken(creds: VonHalskyCredentials, params: Record<string, string>, order: ('basic' | 'body' | 'public')[]): Promise<TokenResponse> {
  const url = vonHalskyHosts(creds.sandbox).token;
  let last: unknown;
  for (const how of order) {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' };
    const form = new URLSearchParams(params);
    if (how === 'basic') headers.Authorization = `Basic ${Buffer.from(`${encodeURIComponent(creds.clientId)}:${encodeURIComponent(creds.clientSecret)}`).toString('base64')}`;
    else form.set('client_id', creds.clientId);
    if (how === 'body') form.set('client_secret', creds.clientSecret);
    try {
      return (await request<TokenResponse>(url, { method: 'POST', headers, body: form, retries: 1 })).data;
    } catch (err) {
      last = err;
      if (!(err instanceof HttpError) || ![400, 401].includes(err.status)) break;
    }
  }
  throw describeTokenError(last);
}

function describeTokenError(err: unknown): unknown {
  const described = describeVonHalskyError(err);
  if (described instanceof VonHalskyApiError && /unauthorized_client/.test(described.message)) {
    return new VonHalskyApiError(
      described.status,
      `${described.message}. This InPost application isn’t allowed to sign in with client credentials (an Authorization Code app): press “Connect Von Halsky” on the Integrations page instead.`,
    );
  }
  if (described instanceof VonHalskyApiError && /invalid_grant/.test(described.message)) {
    return new VonHalskyApiError(described.status, `${described.message}. The InPost login has expired (30 days without use): press “Connect Von Halsky” again.`);
  }
  return described;
}

function withTokens(creds: VonHalskyCredentials, data: TokenResponse): VonHalskyCredentials {
  return {
    ...creds,
    accessToken: data.access_token,
    // A refresh token is replaced every time; keep the old one if the answer carries none.
    refreshToken: data.refresh_token ?? creds.refreshToken,
    expiresAt: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  };
}

function clientCredentialsToken(creds: VonHalskyCredentials): Promise<VonHalskyCredentials> {
  return postToken(creds, { grant_type: 'client_credentials', scope: VON_HALSKY_SCOPES }, ['basic', 'body']).then((d) => withTokens(creds, d));
}

function refreshVonHalskyToken(creds: VonHalskyCredentials): Promise<VonHalskyCredentials> {
  return postToken(creds, { grant_type: 'refresh_token', refresh_token: creds.refreshToken! }, ['public', 'basic', 'body']).then((d) => withTokens(creds, d));
}

/** Exchanges the code from the login redirect for tokens (Authorization Code flow with PKCE). */
export async function exchangeVonHalskyCode(creds: VonHalskyCredentials, code: string, redirectUri: string, verifier: string): Promise<VonHalskyCredentials> {
  const data = await postToken(creds, { grant_type: 'authorization_code', code, redirect_uri: redirectUri, code_verifier: verifier }, ['public', 'basic', 'body']);
  return withTokens(creds, data);
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

  private fetchToken(): Promise<VonHalskyCredentials> {
    const c = this.creds.get();
    return c.refreshToken ? refreshVonHalskyToken(c) : clientCredentialsToken(c);
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
