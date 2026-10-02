// Types shared by every marketplace and carrier integration. Adapters translate
// each provider's payloads into these shapes, so the rest of the app never
// deals with provider-specific JSON.

export const MARKETPLACES = ['shopify', 'allegro', 'empik'] as const;
export type Marketplace = (typeof MARKETPLACES)[number];

export const CARRIERS = ['inpost', 'allegro_shipping'] as const;
export type Carrier = (typeof CARRIERS)[number];

export interface Address {
  name: string;
  company?: string | null;
  /** Street with house and flat number as the buyer typed it, e.g. "Marszałkowska 10/5". */
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  phone?: string | null;
  email?: string | null;
}

export interface Buyer {
  name: string;
  email?: string | null;
  phone?: string | null;
  login?: string | null;
}

/** The buyer asked for an invoice; who it is made out to. */
export interface InvoiceRequest {
  /** Company name, or the person's name for a private buyer. */
  name: string;
  /** Tax number without the country prefix (NIP for Polish companies); null for private buyers. */
  taxId: string | null;
  /** EU VAT prefix when the tax number came with one (e.g. "CZ"); null otherwise. */
  euPrefix: string | null;
  street: string;
  postalCode: string;
  city: string;
  countryCode: string;
  email?: string | null;
}

/** Splits "PL1234567890" / "CZ 12345678" into prefix and digits; plain numbers have no prefix. */
export function splitTaxId(raw: string | null | undefined): { taxId: string | null; euPrefix: string | null } {
  const clean = (raw ?? '').replace(/[\s-]/g, '').toUpperCase();
  if (!clean) return { taxId: null, euPrefix: null };
  const m = clean.match(/^([A-Z]{2})(\w+)$/);
  return m ? { taxId: m[2], euPrefix: m[1] } : { taxId: clean, euPrefix: null };
}

export interface NormalizedOrderItem {
  externalLineId: string;
  sku: string | null;
  name: string;
  quantity: number;
  unitPrice: string;
  /** Offer id (Allegro, Empik) or variant id (Shopify) the line was bought from. */
  externalProductId?: string | null;
  imageUrl?: string | null;
}

export interface NormalizedOrder {
  externalId: string;
  /** Human-friendly number shown in the marketplace UI. */
  externalNumber: string;
  marketplaceStatus: string;
  /** True when the order is paid/accepted and may be shipped. */
  readyToShip: boolean;
  /** Order was cancelled on the marketplace. */
  cancelled: boolean;
  /** Order was already marked as shipped on the marketplace (e.g. outside this app). */
  fulfilled: boolean;
  buyer: Buyer;
  shippingAddress: Address;
  deliveryMethodId?: string | null;
  deliveryMethodName?: string | null;
  /** Parcel locker / pickup point code, e.g. InPost "KRA010". */
  pickupPointId?: string | null;
  codAmount?: string | null;
  totalAmount: string;
  shippingAmount?: string | null;
  currency: string;
  placedAt: Date;
  paidAt?: Date | null;
  items: NormalizedOrderItem[];
  /** Set when the buyer asked for an invoice. */
  invoiceRequest?: InvoiceRequest | null;
  revision?: string | null;
  raw: unknown;
}

/** The minimal order data an adapter needs to act on an order it synced earlier. */
export interface OrderRef {
  externalId: string;
  externalNumber: string;
  raw: unknown;
  items: { externalLineId: string; quantity: number }[];
}

export interface TrackingInfo {
  carrier: Carrier;
  /** Carrier code reported by the carrier, e.g. "INPOST", "ALLEGRO", "DPD". */
  carrierCode?: string | null;
  carrierName: string;
  /** Service the label was bought with, e.g. "inpost_locker_standard". */
  service?: string | null;
  trackingNumber: string;
  trackingUrl?: string | null;
}

export interface Listing {
  externalId: string;
  sku: string | null;
  title: string;
  quantity: number | null;
  /** Provider ids needed to update stock later (inventory item id, offer sku, ...). */
  ref: Record<string, string | number | null>;
  imageUrl?: string | null;
}

export interface StockUpdate {
  externalId: string;
  sku: string | null;
  ref: Record<string, string | number | null>;
  quantity: number;
}

export interface ParcelSpec {
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  weightKg: number;
  /** InPost locker size, used instead of dimensions for locker services. */
  inpostTemplate?: 'small' | 'medium' | 'large' | null;
}

export interface SenderSettings {
  name: string;
  company?: string | null;
  street: string;
  city: string;
  postalCode: string;
  countryCode: string;
  phone: string;
  email: string;
}

export type LabelFormat = 'pdf' | 'zpl';
export type LabelSize = 'A4' | 'A6';

export interface CredentialsStore<T> {
  get(): T;
  /** Persist refreshed tokens. */
  save(next: T): Promise<void>;
}
