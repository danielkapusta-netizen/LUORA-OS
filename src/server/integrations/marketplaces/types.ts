import type { Listing, Marketplace, NormalizedFee, NormalizedOrder, NormalizedRefund, OrderRef, StockUpdate, TrackingInfo } from '../types';

/** File name marketplaces accept for an invoice: ASCII only, e.g. "faktura-12-10-2026.pdf". */
export function invoiceFileName(number: string): string {
  return `faktura-${number.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}.pdf`;
}

export interface SyncResult {
  orders: NormalizedOrder[];
  /** Saved after the orders are stored, and passed to the next call. */
  nextCursor: string | null;
  /** More orders are waiting; the caller should sync again right away. */
  hasMore: boolean;
}

/** A fee charged for an order, reported by a separate billing feed. */
export interface ExternalFee extends NormalizedFee {
  orderExternalId: string;
}

/** A refund reported outside the order. `amount` is null when only the returned quantity is known. */
export interface ExternalRefund extends Omit<NormalizedRefund, 'amount'> {
  orderExternalId: string;
  amount: string | null;
}

export interface FeeFeed {
  fees: ExternalFee[];
  refunds: ExternalRefund[];
  /** Charges with no order (listing fees, ads, subscriptions); counted but not stored per order. */
  unattached: number;
}

export interface MarketplaceAdapter {
  readonly marketplace: Marketplace;

  /** Returns a short description of the connected account, e.g. the shop name. */
  checkConnection(): Promise<string>;

  /** Fetches orders created or changed since `cursor` (null on the first sync). */
  syncOrders(cursor: string | null): Promise<SyncResult>;

  /**
   * One step of the one-off import of past orders, newest first. `cursor` is null on the first
   * call; a result with `hasMore: false` means the history is complete. The orders are stored as
   * historical: they never create labels, invoices or stock movements.
   */
  syncHistory?(cursor: string | null): Promise<SyncResult>;

  /** Fees and refunds booked between two times, when the marketplace reports them outside the order (Allegro). */
  syncFees?(from: Date, to: Date): Promise<FeeFeed>;

  /** Re-reads one order, e.g. after accepting it. */
  getOrder(externalId: string): Promise<NormalizedOrder | null>;

  /** Adds the tracking number to the order and marks it as shipped. Must be safe to call twice. */
  pushTracking(order: OrderRef, tracking: TrackingInfo): Promise<void>;

  /** Tells the marketplace the order is being prepared (Allegro "PROCESSING"). */
  markProcessing?(order: OrderRef): Promise<void>;

  /** Accepts an order that waits for the seller's decision (Empik). */
  acceptOrder?(order: OrderRef): Promise<void>;

  /** Attaches the invoice PDF to the order. Must be safe to call twice (skips an invoice already there). */
  uploadInvoice?(order: OrderRef, invoice: { number: string; pdf: Buffer }): Promise<void>;

  listListings(): AsyncIterable<Listing>;

  /**
   * Barcodes for listings whose list call doesn't include them (Allegro: read from the offer's
   * catalogue product). Returns externalId → EAN, or null when the offer has none.
   */
  listingEans?(externalIds: string[]): Promise<Map<string, string | null>>;

  /** Sets absolute stock quantities. */
  setStock(updates: StockUpdate[]): Promise<void>;
}

/** What an offer needs from the Shopify product, whichever marketplace it goes to. */
export interface OfferDraft {
  sku: string;
  ean: string;
  name: string;
  descriptionHtml: string;
  brand: string;
  imageUrls: string[];
  weightGrams: number | null;
  quantity: number;
  /** Gross price with two decimals. */
  price: string;
  currency: string;
}

/** The marketplace's own catalogue product for an EAN: offers are attached to it. */
export interface CatalogueMatch {
  found: boolean;
  /** The catalogue product id the offer attaches to (Allegro). */
  ref?: string;
  name?: string;
  /** The marketplace could not be asked, so the answer is a guess; its import decides. */
  unverified?: boolean;
}

/** Marketplaces Luora can create offers on, for products that exist in their catalogue. */
export interface OfferPublisher {
  /** What is missing in the account settings before any offer can be created (empty when ready). */
  publishSetupProblems(): string[];
  /** Which of these EANs the marketplace catalogue knows. */
  checkCatalogue(eans: string[]): Promise<Map<string, CatalogueMatch>>;
  /** Creates one offer; throws with the marketplace's reasons when it refuses. Returns a note when it is still being processed. */
  createOffer(draft: OfferDraft, match: CatalogueMatch): Promise<{ externalId?: string; note?: string }>;
}

export function isOfferPublisher(adapter: unknown): adapter is OfferPublisher {
  return typeof adapter === 'object' && adapter !== null && 'checkCatalogue' in adapter && 'createOffer' in adapter;
}
