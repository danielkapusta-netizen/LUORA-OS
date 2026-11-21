// Thin client for the Erli.pl Shop API (https://erli.pl/svc/shop-api/doc/). Amounts are in grosze.
import { HttpError, request, type RequestOptions } from '../../../http';

export interface ErliCredentials {
  /** The shop's API key, from Erli's panel: Metoda integracji → Własna integracja po API. */
  apiKey: string;
  /** Erli's sandbox host, when testing there; production otherwise. */
  baseUrl?: string;
}

export const ERLI_API = 'https://erli.pl/svc/shop-api';

/** An Erli API error with Erli's own message, readable for staff. */
export class ErliApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ErliApiError';
  }
}

/** Erli answers errors either as `[{errorCode, errorMessage}]` or as `{message, polishMessage, errorCode, payload}`. */
export function describeErliError(body: string): string | null {
  try {
    const data = JSON.parse(body) as unknown;
    const list = Array.isArray(data) ? data : [data];
    const parts = list
      .map((e: { errorMessage?: string; polishMessage?: string; message?: string; payload?: { details?: string } }) =>
        [e?.polishMessage || e?.errorMessage || e?.message, e?.payload?.details].filter(Boolean).join(' – '),
      )
      .filter(Boolean);
    return parts.length ? parts.join('; ') : null;
  } catch {
    return body.trim() ? body.trim().slice(0, 300) : null;
  }
}

export class ErliClient {
  constructor(private readonly creds: ErliCredentials) {}

  private get base(): string {
    return (this.creds.baseUrl?.trim() || ERLI_API).replace(/\/+$/, '');
  }

  async call<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    if (!this.creds.apiKey) throw new Error('Erli has no API key yet. Add it in Settings → Integrations.');
    try {
      const { data } = await request<T>(`${this.base}${path}`, {
        ...options,
        method,
        headers: { Authorization: `Bearer ${this.creds.apiKey}`, Accept: 'application/json', 'User-Agent': 'LuoraOS/1.0 (+erli integration)', ...options.headers },
      });
      return data;
    } catch (err) {
      if (err instanceof HttpError) {
        const why = describeErliError(err.body);
        throw new ErliApiError(err.status, `Erli (HTTP ${err.status}): ${why ?? 'no details'}`);
      }
      throw err;
    }
  }
}
