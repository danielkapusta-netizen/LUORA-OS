// Types shared by invoicing integrations (ifirma, and the mock used in demo mode).

export type InvoiceKind = 'domestic' | 'oss';

export interface IssuedInvoice {
  /** The accounting system's invoice id. */
  externalId: string;
}

export interface InvoiceDetails {
  /** Full invoice number as printed, e.g. "12/10/2026". */
  number: string | null;
  /** KSeF status reported by the accounting system, e.g. "PRZYJETA". */
  ksefStatus: string | null;
}

export interface InvoicingAdapter {
  /** Returns a short description of the connected account; throws if the credentials don't work. */
  checkConnection(): Promise<string>;
  create(kind: InvoiceKind, payload: object): Promise<IssuedInvoice>;
  getPdf(kind: InvoiceKind, externalId: string): Promise<Buffer>;
  /** Number and KSeF status of an issued invoice, looked up from the invoice list. */
  getDetails(externalId: string, issuedOn: string): Promise<InvoiceDetails>;
  sendToKsef(kind: InvoiceKind, externalId: string): Promise<void>;
  /** Standard ("POD") VAT rate in an EU country, as a fraction (0.21). */
  standardVatRate(countryCode: string): Promise<number>;
}
