// Order → ifirma invoice payload. Pure functions, so they're easy to test.
import type { AccountingSettings } from '../../../db/schema';
import type { Address, InvoiceRequest } from '../../types';
import type { InvoiceKind } from '../types';

export const EU_COUNTRIES = new Set([
  'AT', 'BE', 'BG', 'CY', 'CZ', 'DE', 'DK', 'EE', 'ES', 'FI', 'FR', 'GR', 'EL', 'HR', 'HU', 'IE', 'IT',
  'LT', 'LU', 'LV', 'MT', 'NL', 'PL', 'PT', 'RO', 'SE', 'SI', 'SK',
]);

/** ifirma's language codes for OSS invoices; anything else gets English. */
const LANGUAGES: Record<string, string> = {
  CZ: 'cs', SK: 'sk', HU: 'hu', DE: 'de', AT: 'de', LT: 'lt', LV: 'lv', EE: 'et', FR: 'fr', IT: 'it', ES: 'es',
  NL: 'nl', FI: 'fi', SE: 'sv', DK: 'da', HR: 'hr', BG: 'bg', SI: 'sl', GR: 'gr', EL: 'gr',
};

export type InvoicePlan = { kind: InvoiceKind } | { kind: 'manual'; reason: string };

export interface InvoiceOrder {
  marketplace: string;
  externalNumber: string;
  shippingAddress: Address;
  currency: string;
  totalAmount: string;
  shippingAmount: string | null;
  codAmount: string | null;
}

export interface InvoiceLine {
  name: string;
  quantity: number;
  unitPrice: string;
}

const MARKETPLACE_NAMES: Record<string, string> = { allegro: 'Allegro', empik: 'Empik', shopify: 'Shopify' };

const cents = (v: string | number | null | undefined) => Math.round(Number(v ?? 0) * 100);

/**
 * Which invoice an order needs. The place of supply is where the parcel goes:
 * Poland → domestic invoice; a private buyer elsewhere in the EU → OSS invoice.
 * Foreign companies (intra-EU supply, WDT) and buyers outside the EU are left for a person.
 */
export function planInvoice(order: InvoiceOrder, items: InvoiceLine[], req: InvoiceRequest): InvoicePlan {
  const dest = order.shippingAddress.countryCode.toUpperCase();
  const lines = items.reduce((sum, i) => sum + cents(i.unitPrice) * i.quantity, 0) + cents(order.shippingAmount);
  if (Math.abs(lines - cents(order.totalAmount)) > 1) {
    return {
      kind: 'manual',
      reason: `Order total (${order.totalAmount} ${order.currency}) differs from products + shipping (${(lines / 100).toFixed(2)}), e.g. a discount; issue it in ifirma by hand`,
    };
  }
  if (dest === 'PL') {
    if (order.currency !== 'PLN') return { kind: 'manual', reason: `Polish order paid in ${order.currency}; issue it in ifirma by hand` };
    return { kind: 'domestic' };
  }
  if (!EU_COUNTRIES.has(dest)) return { kind: 'manual', reason: `Buyer outside the EU (${dest}) needs an export invoice; issue it in ifirma by hand` };
  if (req.taxId) return { kind: 'manual', reason: `Company in ${dest} needs an intra-EU (WDT) invoice; issue it in ifirma by hand` };
  return { kind: 'oss' };
}

export interface PayloadContext {
  /** Issue date, YYYY-MM-DD (Europe/Warsaw). */
  issueDate: string;
  /** Sale date (when the parcel shipped), YYYY-MM-DD (Europe/Warsaw). */
  saleDate: string;
  settings: AccountingSettings;
  /** VAT rate for the lines, as a fraction (0.23 in Poland, the destination's rate for OSS). */
  vatRate: number;
  /** NBP rate from the business day before the issue date; only for invoices not in PLN. */
  exchangeRate?: number | null;
}

function common(order: InvoiceOrder, ctx: PayloadContext) {
  const cod = cents(order.codAmount) > 0;
  return {
    cod,
    fields: {
      DataWystawienia: ctx.issueDate,
      DataSprzedazy: ctx.saleDate,
      FormatDatySprzedazy: 'DZN',
      MiejsceWystawienia: ctx.settings.placeOfIssue || undefined,
      NazwaSeriiNumeracji: ctx.settings.numberingSeries || undefined,
      LiczOd: 'BRT',
      // Marketplace orders are paid online, or in cash to the courier.
      SposobZaplaty: cod ? 'POB' : 'ELE',
      TerminPlatnosci: cod ? ctx.saleDate : undefined,
      RodzajPodpisuOdbiorcy: 'BPO',
      PodpisWystawcy: ctx.settings.issuerSignature || undefined,
      Uwagi: `Zamówienie ${MARKETPLACE_NAMES[order.marketplace] ?? order.marketplace} ${order.externalNumber}`,
    },
  };
}

function lines(order: InvoiceOrder, items: InvoiceLine[]) {
  const out = items.map((i) => ({ name: i.name.slice(0, 300), quantity: i.quantity, price: Number(i.unitPrice) }));
  if (cents(order.shippingAmount) > 0) out.push({ name: 'Dostawa', quantity: 1, price: Number(order.shippingAmount) });
  return out;
}

/** Domestic sales invoice (POST fakturakraj.json). */
export function buildDomesticPayload(order: InvoiceOrder, items: InvoiceLine[], req: InvoiceRequest, ctx: PayloadContext) {
  const { cod, fields } = common(order, ctx);
  const paid = cod ? 0 : Number(order.totalAmount);
  return {
    ...fields,
    Zaplacono: paid,
    ZaplaconoNaDokumencie: paid,
    WidocznyNumerGios: false,
    Numer: null,
    Pozycje: lines(order, items).map((l) => ({
      NazwaPelna: l.name,
      Ilosc: l.quantity,
      CenaJednostkowa: l.price,
      Jednostka: 'szt.',
      StawkaVat: ctx.vatRate,
      TypStawkiVat: 'PRC',
    })),
    Kontrahent: {
      Nazwa: req.name.slice(0, 150),
      Identyfikator: null,
      PrefiksUE: req.euPrefix && req.euPrefix !== 'PL' ? req.euPrefix : null,
      NIP: req.taxId,
      Ulica: req.street.slice(0, 65) || undefined,
      KodPocztowy: req.postalCode || '00-000',
      Miejscowosc: req.city.slice(0, 65),
      KodKraju: req.countryCode,
      Email: req.email || undefined,
      OsobaFizyczna: !req.taxId,
    },
  };
}

/** OSS sales evidence for a private buyer elsewhere in the EU (POST fakturaoss.json). */
export function buildOssPayload(order: InvoiceOrder, items: InvoiceLine[], req: InvoiceRequest, ctx: PayloadContext) {
  const { fields } = common(order, ctx);
  const dest = order.shippingAddress.countryCode.toUpperCase();
  if (order.currency !== 'PLN' && !ctx.exchangeRate) throw new Error(`An exchange rate is needed for an invoice in ${order.currency}`);
  return {
    ...fields,
    Jezyk: LANGUAGES[dest] ?? 'en',
    Waluta: order.currency,
    KursWalutyZDniaPoprzedzajacegoDzienWystawieniaFaktury: order.currency !== 'PLN' ? ctx.exchangeRate : undefined,
    WidocznyNumerBdo: false,
    KrajDostawy: dest === 'GR' ? 'EL' : dest,
    KrajWysylki: 'PL',
    SprzedazUslug: false,
    Pozycje: lines(order, items).map((l) => ({
      NazwaPelna: l.name,
      NazwaPelnaObca: l.name === 'Dostawa' ? 'Shipping' : l.name,
      Ilosc: l.quantity,
      CenaJednostkowa: l.price,
      Jednostka: 'szt.',
      JednostkaObca: 'pcs',
      StawkaVat: ctx.vatRate,
      TypStawkiVat: 'POD',
    })),
    Kontrahent: {
      Nazwa: req.name.slice(0, 150),
      Identyfikator: null,
      PrefiksUE: null,
      NIP: null,
      Ulica: req.street.slice(0, 65) || undefined,
      KodPocztowy: req.postalCode || undefined,
      KodKraju: req.countryCode,
      AdresZagraniczny: true,
      Miejscowosc: req.city.slice(0, 65),
      Email: req.email || undefined,
      OsobaFizyczna: true,
    },
  };
}

/** YYYY-MM-DD in Poland's time zone, which invoice dates follow. */
export function warsawDate(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
