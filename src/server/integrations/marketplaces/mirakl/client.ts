import type { MiraklOfferField } from '../../../db/schema';
import { HttpError, request, type RequestOptions } from '../../../http';

export interface MiraklCredentials {
  /** Mirakl front URL given by the marketplace, e.g. "https://marketplace.empik.com". */
  baseUrl: string;
  apiKey: string;
  /** Only needed when the API key has access to several shops. */
  shopId?: string;
}

/** Empik and HEBE both run on Mirakl; this is a thin client for the Mirakl Seller API. */
export interface MiraklCarrier {
  code: string;
  label: string;
  tracking_url?: string | null;
}

export class MiraklClient {
  constructor(
    private readonly creds: MiraklCredentials,
    /** Marketplace name used in error messages, e.g. "Empik". */
    private readonly label = 'Mirakl',
  ) {}

  /** SH21: carriers registered on the marketplace (call at most once a day). */
  async listCarriers(): Promise<MiraklCarrier[]> {
    const data = await this.call<{ carriers: MiraklCarrier[] }>('GET', '/shipping/carriers');
    return data.carriers.map((c) => ({ code: c.code, label: c.label, tracking_url: c.tracking_url ?? null }));
  }

  /** AF01: the extra fields this marketplace defines on offers (call at most once a day). Fields the seller can't edit are left out. */
  async listOfferFields(): Promise<MiraklOfferField[]> {
    const data = await this.call<{
      additional_fields?: {
        code: string;
        label: string;
        type: string;
        required?: boolean;
        editable?: boolean;
        description?: string | null;
        default_value?: string | null;
        accepted_values?: string[];
      }[];
    }>('GET', '/additional_fields', { query: { entities: 'OFFER' } });
    return (data.additional_fields ?? [])
      .filter((f) => f.editable !== false)
      .map((f) => ({
        code: f.code,
        label: f.label || f.code,
        type: f.type,
        required: Boolean(f.required),
        description: f.description || null,
        defaultValue: f.default_value || null,
        ...(f.accepted_values?.length ? { acceptedValues: f.accepted_values } : {}),
      }));
  }

  async call<T>(method: string, path: string, options: Omit<RequestOptions, 'method'> = {}): Promise<T> {
    const base = this.creds.baseUrl.replace(/\/+$/, '').replace(/\/api$/, '');
    try {
      const { data } = await request<T>(`${base}/api${path}`, {
        ...options,
        method,
        query: { ...options.query, shop_id: this.creds.shopId },
        headers: { Authorization: this.creds.apiKey, Accept: 'application/json', ...options.headers },
      });
      return data;
    } catch (err) {
      throw readableMiraklError(err, this.label);
    }
  }
}

/** Mirakl errors look like {"message": "...", "status": 400}; surface the message. */
function readableMiraklError(err: unknown, label: string): unknown {
  if (!(err instanceof HttpError)) return err;
  try {
    const body = JSON.parse(err.body) as { message?: string; errors?: { field?: string; message?: string }[] };
    const details = body.errors?.map((e) => (e.field ? `${e.field}: ${e.message}` : e.message)).filter(Boolean).join('; ');
    const message = [body.message, details].filter(Boolean).join(' – ');
    if (message) return new Error(`${label} (HTTP ${err.status}): ${message}`);
  } catch {
    // Not JSON: keep the original error.
  }
  return err;
}
