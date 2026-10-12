// A supplier's purchase invoice turned into landed unit costs.
import { normalizeEan } from './sku';

export interface InvoiceLine {
  /** EAN, SKU or product name as written on the invoice. */
  key: string;
  qty: number;
  /** Unit price in the invoice's currency, as printed. */
  price: number;
}

/** Parses "1 234,50" / "6.49" into a number; null when it is no number. */
export function toNumber(value: string | undefined): number | null {
  if (value === undefined) return null;
  const clean = value
    .replace(/[^\d,.-]/g, '')
    .replace(/,(?=\d{1,2}$)/, '.')
    .replace(/,/g, '');
  if (!clean || clean === '-' || clean === '.') return null;
  const n = Number(clean);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pasted invoice rows, one product per line, columns separated by a tab or ";":
 *  - "EAN; quantity; unit price" (or SKU / name instead of the EAN), or
 *  - a whole row copied from the invoice table: the barcode column is found, and the quantity and unit price are
 *    the two columns after it (the amount column that follows is ignored).
 * "key; price" counts as one piece. Lines without a price (headers, totals) are skipped.
 */
export function parseInvoiceLines(text: string): InvoiceLine[] {
  const out: InvoiceLine[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw
      .split(/\t|;/)
      .map((p) => p.trim().replace(/^"|"$/g, ''))
      .filter((p) => p !== '');
    if (parts.length < 2) continue;
    const eanAt = parts.findIndex((p) => /^\d{8,14}$/.test(p) && normalizeEan(p));
    let key: string;
    let qty: number | null;
    let price: number | null;
    if (eanAt >= 0 && parts.length >= eanAt + 3) {
      key = parts[eanAt];
      qty = toNumber(parts[eanAt + 1]);
      price = toNumber(parts[eanAt + 2]);
    } else if (parts.length >= 3) {
      key = parts.slice(0, -2).join(' ');
      qty = toNumber(parts.at(-2));
      price = toNumber(parts.at(-1));
    } else {
      key = parts[0];
      qty = 1;
      price = toNumber(parts[1]);
    }
    if (key && qty !== null && qty > 0 && price !== null && price >= 0) out.push({ key, qty, price });
  }
  return out;
}

export interface InvoiceTerms {
  /** Unit prices include VAT. */
  vatIncluded: boolean;
  /** 0.23 for 23%. */
  vatRate: number;
  /** Delivery charge on the invoice, in the invoice currency. */
  deliveryTotal: number;
  deliveryIncludesVat: boolean;
  /** Customs duty and other extra costs of the whole delivery, in PLN, net. */
  extraPln: number;
}

/** Net unit price (VAT is recovered, so costs are kept without it). */
export function netPrice(price: number, terms: Pick<InvoiceTerms, 'vatIncluded' | 'vatRate'>): number {
  return terms.vatIncluded ? price / (1 + terms.vatRate) : price;
}

/**
 * What every piece carries on top of its price: the delivery charge (net, converted at `rate`) and the extra costs,
 * both spread evenly over all pieces on the invoice.
 */
export function sharedCosts(pieces: number, terms: InvoiceTerms, rate: number): { freightPln: number; extraPln: number } {
  if (pieces <= 0) return { freightPln: 0, extraPln: 0 };
  const deliveryNet = terms.deliveryIncludesVat ? terms.deliveryTotal / (1 + terms.vatRate) : terms.deliveryTotal;
  return { freightPln: (deliveryNet * rate) / pieces, extraPln: terms.extraPln / pieces };
}
