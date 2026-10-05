// ifirma.pl API (https://api.ifirma.pl): issues invoices, downloads PDFs and sends them to KSeF.
import { createHmac } from 'node:crypto';
import { HttpError, request } from '../../../http';
import type { InvoiceDetails, InvoiceKind, InvoicingAdapter, IssuedInvoice } from '../types';

export interface IfirmaCredentials {
  /** Login used to sign in to ifirma.pl. */
  login: string;
  /** "faktura" API key from ifirma → Konfiguracja → API, as the hex string shown there. */
  invoiceKey: string;
}

export const IFIRMA_BASE = 'https://www.ifirma.pl/iapi/';
const KEY_NAME = 'faktura';

const PATHS: Record<InvoiceKind, string> = { domestic: 'fakturakraj', oss: 'fakturaoss' };

/**
 * ifirma's "Authentication" header: HMAC-SHA1 over url (without query) + login + key name + body,
 * keyed with the bytes of the hex key.
 */
export function ifirmaAuthHeader(url: string, login: string, keyHex: string, body: string): string {
  const signedUrl = url.split('?')[0];
  const mac = createHmac('sha1', Buffer.from(keyHex.trim(), 'hex'))
    .update(signedUrl + login + KEY_NAME + body)
    .digest('hex');
  return `IAPIS user=${login}, hmac-sha1=${mac}`;
}

interface IfirmaResponse<T = unknown> {
  response: { Kod: number; Informacja?: string | null; Identyfikator?: string | number | null; Wynik?: T } & Record<string, unknown>;
}

export class IfirmaError extends Error {
  constructor(
    readonly code: number,
    message: string,
  ) {
    super(message);
    this.name = 'IfirmaError';
  }
}

/** How much of an unexpected ifirma answer goes into an error message. */
const RAW_ANSWER_LIMIT = 300;

/**
 * ifirma answers HTTP 200 with a non-zero "Kod" on errors; turn that into a readable error.
 * `lenient` is for the dictionary endpoints (VAT rates), whose answers carry no "Kod" at all.
 */
function unwrap<T>(data: IfirmaResponse<T>, lenient = false): IfirmaResponse<T>['response'] {
  const r = data?.response;
  if (!r) throw new IfirmaError(-1, `ifirma returned an unexpected answer: ${raw(data)}`);
  if (r.Kod === undefined || r.Kod === null) {
    if (lenient) return r;
    throw new IfirmaError(-1, `ifirma returned an answer without a result code: ${raw(data)}`);
  }
  if (r.Kod !== 0) throw new IfirmaError(r.Kod, `ifirma (kod ${r.Kod}): ${r.Informacja || raw(data)}`);
  return r;
}

function raw(data: unknown): string {
  const text = typeof data === 'string' ? data : JSON.stringify(data);
  return (text ?? 'nothing').slice(0, RAW_ANSWER_LIMIT);
}

export class IfirmaClient implements InvoicingAdapter {
  constructor(private readonly creds: IfirmaCredentials) {}

  private async call<T>(
    method: 'GET' | 'POST',
    path: string,
    body?: object,
    query?: Record<string, string>,
    lenient = false,
  ): Promise<IfirmaResponse<T>['response']> {
    const url = new URL(path, IFIRMA_BASE);
    for (const [k, v] of Object.entries(query ?? {})) url.searchParams.set(k, v);
    const content = body ? JSON.stringify(body) : '';
    try {
      const { data } = await request<IfirmaResponse<T>>(url.toString(), {
        method,
        body: body ? content : undefined,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json; charset=UTF-8',
          Authentication: ifirmaAuthHeader(url.toString(), this.creds.login, this.creds.invoiceKey, content),
        },
        // A retried POST could issue a second invoice.
        retries: method === 'POST' ? 0 : 3,
      });
      return unwrap(data, lenient);
    } catch (err) {
      if (err instanceof HttpError) {
        try {
          unwrap(JSON.parse(err.body) as IfirmaResponse);
        } catch (inner) {
          if (inner instanceof IfirmaError) throw inner;
        }
      }
      throw err;
    }
  }

  async checkConnection(): Promise<string> {
    const today = new Date().toISOString().slice(0, 10);
    await this.call('GET', 'faktury.json', undefined, { dataOd: today, iloscNaStronie: '1' });
    return `ifirma: ${this.creds.login}`;
  }

  async create(kind: InvoiceKind, payload: object): Promise<IssuedInvoice> {
    const r = await this.call('POST', `${PATHS[kind]}.json`, payload);
    if (r.Identyfikator == null) throw new IfirmaError(-1, 'ifirma did not return the invoice id');
    return { externalId: String(r.Identyfikator) };
  }

  async getPdf(kind: InvoiceKind, externalId: string): Promise<Buffer> {
    const url = new URL(`${PATHS[kind]}/${encodeURIComponent(externalId)}.pdf`, IFIRMA_BASE).toString();
    const { data } = await request<Buffer>(url, {
      method: 'GET',
      responseType: 'buffer',
      headers: {
        Accept: 'application/pdf',
        'Content-Type': 'application/pdf; charset=UTF-8',
        Authentication: ifirmaAuthHeader(url, this.creds.login, this.creds.invoiceKey, ''),
      },
    });
    if (data.subarray(0, 4).toString() !== '%PDF') {
      // Errors come back as JSON even when a PDF was asked for.
      unwrap(JSON.parse(data.toString('utf8')) as IfirmaResponse);
      throw new IfirmaError(-1, 'ifirma did not return a PDF');
    }
    return data;
  }

  async getDetails(externalId: string, issuedOn: string): Promise<InvoiceDetails> {
    const r = await this.call<{ FakturaId: number; PelnyNumer: string; KsefStatus?: string | null }[]>('GET', 'faktury.json', undefined, {
      dataOd: issuedOn,
      dataDo: issuedOn,
      iloscNaStronie: '100',
    });
    const found = (r.Wynik ?? []).find((f) => String(f.FakturaId) === externalId);
    return { number: found?.PelnyNumer ?? null, ksefStatus: found?.KsefStatus ?? null };
  }

  async sendToKsef(kind: InvoiceKind, externalId: string): Promise<void> {
    await this.call('POST', `${PATHS[kind]}/ksef/send/${encodeURIComponent(externalId)}.json`, { DataWysylki: null });
  }

  async standardVatRate(countryCode: string): Promise<number> {
    const code = countryCode.toUpperCase() === 'GR' ? 'EL' : countryCode.toUpperCase();
    // The VAT-rate dictionary answers { response: { KodKraju, NazwaKraju, StawkiVat } } without a "Kod".
    const r = await this.call('GET', `slownik/stawki_vat/${code}.json`, undefined, undefined, true);
    const rates = (r.StawkiVat ?? []) as { Rodzaj: string; Wartosc: number }[];
    const standard = rates.find((s) => s.Rodzaj === 'POD');
    if (!standard) throw new IfirmaError(-1, `ifirma has no standard VAT rate for ${code}`);
    return Math.round(standard.Wartosc * 100) / 10000;
  }
}
