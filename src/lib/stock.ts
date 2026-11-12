// What a listing should be sent and what a marketplace most likely shows. Pure, so the stock push, the full update
// and the Inventory page all decide the same way.

/** Status of a listing the marketplace no longer has (a variant deleted in Shopify, an offer removed on Allegro). */
export const GONE = 'GONE';

/** What decides whether, and what, a listing is sent. */
export interface StockTarget {
  stock: number;
  active?: boolean;
  /** Off sale only because it has no units there: it is still sent to, and comes back with a quantity above zero. */
  soldOut?: boolean;
  /** The marketplace counts this quantity itself (a Shopify bundle). */
  stockLocked?: string | null;
  stockMode?: 'master' | 'fixed' | 'off';
  fixedQty?: number | null;
}

/**
 * The quantity a listing should show, or null when nothing is to be sent to it: it is managed on the marketplace,
 * the marketplace counts it itself, or it is off sale for a reason other than having sold out.
 */
export function desiredQuantity(r: StockTarget): number | null {
  if (r.stockMode === 'off' || r.stockLocked) return null;
  if (r.active === false && !r.soldOut) return null;
  if (r.stockMode === 'fixed') return r.fixedQty == null ? null : Math.max(0, Math.floor(r.fixedQty));
  return Math.max(0, r.stock);
}

/** What the marketplace most likely shows now: our last push, unless an import read it later. */
export function marketplaceQuantity(l: { lastSeenQty: number | null; lastSeenAt: Date | null; lastPushedQty: number | null; lastPushedAt: Date | null }): number | null {
  if (l.lastPushedAt && l.lastPushedQty !== null && (!l.lastSeenAt || l.lastPushedAt >= l.lastSeenAt)) return l.lastPushedQty;
  return l.lastSeenQty;
}
