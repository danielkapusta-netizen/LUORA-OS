import type { Listing, Marketplace, NormalizedOrder, OrderRef, StockUpdate, TrackingInfo } from '../types';

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

export interface MarketplaceAdapter {
  readonly marketplace: Marketplace;

  /** Returns a short description of the connected account, e.g. the shop name. */
  checkConnection(): Promise<string>;

  /** Fetches orders created or changed since `cursor` (null on the first sync). */
  syncOrders(cursor: string | null): Promise<SyncResult>;

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

  /** Sets absolute stock quantities. */
  setStock(updates: StockUpdate[]): Promise<void>;
}
