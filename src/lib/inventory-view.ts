// How the Inventory page groups, orders and reads products: brands, the sort orders, and what one marketplace
// shows for a product. No database here, so it is unit-tested.
import { inferBrand } from './analytics/orders';
import { desiredQuantity, GONE, marketplaceQuantity } from './stock';

export const SORTS = ['brand', 'sales', 'name', 'stock', 'new'] as const;
export type InventorySort = (typeof SORTS)[number];

export const FILTERS = ['all', 'out', 'low', 'differs', 'off'] as const;
export type InventoryFilter = (typeof FILTERS)[number];

/** Below this many units a product counts as running low. */
export const LOW_STOCK = 5;

/**
 * One key for every spelling of a brand: Shopify vendors are typed by hand, so "ROUND LAB", "Round Lab" and
 * "numbuzin" / "Numbuzin" must land in one group.
 */
export function brandKey(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9+]+/g, ' ')
    .trim();
}

/** The product's brand: its Shopify vendor, else the brand its name starts with; null when neither is known. */
export function brandOfProduct(p: { brand: string | null; name: string }): string | null {
  const own = p.brand?.trim();
  if (own) return own;
  const inferred = inferBrand(p.name);
  return inferred === 'Other' ? null : inferred;
}

export interface BrandGroup<P> {
  key: string;
  /** The spelling most of its products use; null for products without a brand. */
  label: string | null;
  products: P[];
}

/** Products by brand, brands A to Z (those without a brand last), products by name inside a brand. */
export function groupByBrand<P extends { brand: string | null; name: string }>(products: P[]): BrandGroup<P>[] {
  const groups = new Map<string, { spellings: Map<string, number>; products: P[] }>();
  for (const p of products) {
    const brand = brandOfProduct(p);
    const key = brand ? brandKey(brand) : '';
    const group = groups.get(key) ?? { spellings: new Map<string, number>(), products: [] };
    if (brand) group.spellings.set(brand, (group.spellings.get(brand) ?? 0) + 1);
    group.products.push(p);
    groups.set(key, group);
  }
  return [...groups]
    .map(([key, g]) => ({
      key,
      // Map keeps insertion order, so with equal counts the spelling met first wins.
      label: key ? [...g.spellings].reduce((best, s) => (s[1] > best[1] ? s : best))[0] : null,
      products: [...g.products].sort((a, b) => a.name.localeCompare(b.name, 'pl')),
    }))
    .sort((a, b) => (a.label === null ? 1 : b.label === null ? -1 : a.label.localeCompare(b.label, 'pl', { sensitivity: 'base' })));
}

/** The flat orders of the list. "brand" has no flat order of its own: it is the grouped view, sorted by name here. */
export function sortProducts<P extends { id: string; name: string; stock: number; createdAt: Date }>(products: P[], sort: InventorySort, unitsSold: (id: string) => number): P[] {
  const byName = (a: P, b: P) => a.name.localeCompare(b.name, 'pl');
  return [...products].sort((a, b) =>
    sort === 'sales' ? unitsSold(b.id) - unitsSold(a.id) || byName(a, b) : sort === 'stock' ? a.stock - b.stock || byName(a, b) : sort === 'new' ? b.createdAt.getTime() - a.createdAt.getTime() || byName(a, b) : byName(a, b),
  );
}

/** What the page needs to know about a listing to say how the product stands on its marketplace. */
export interface ListingForCell {
  id: string;
  accountId: string;
  marketplace: string;
  active: boolean;
  soldOut: boolean;
  stockLocked: string | null;
  listingStatus: string | null;
  stockMode: 'master' | 'fixed' | 'off';
  fixedQty: number | null;
  lastSeenQty: number | null;
  lastSeenAt: Date | null;
  lastPushedQty: number | null;
  lastPushedAt: Date | null;
  lastPushError: string | null;
  ref: Record<string, string | number | null>;
}

/**
 * - none: no offer there.
 * - ok: on sale and showing what it should.
 * - differs: showing another number than it should (a sold-out offer waiting for its stock is one of these).
 * - error: the marketplace refused the last update.
 * - off: off sale for a reason other than having sold out; nothing is sent until it is activated.
 * - gone: the offer no longer exists on the marketplace.
 * - locked: the marketplace counts the quantity itself (a Shopify bundle).
 * - manual: set to be managed on the marketplace.
 */
export type CellKind = 'none' | 'ok' | 'differs' | 'error' | 'off' | 'gone' | 'locked' | 'manual';

export interface MarketplaceCell {
  kind: CellKind;
  /** What the marketplace shows, one number per offer that is on sale or sold out. */
  shown: (number | null)[];
  /** What those offers should show. */
  want: number | null;
  /** The marketplace's refusal, or its status for an off-sale offer. */
  reason: string | null;
  /** The off-sale offer an Activate button would put back on sale: only when there is stock and the account is sent to. */
  activateId: string | null;
  /** Nothing is sent to this account (sync off, or dry run), so a difference stays until someone decides. */
  held: boolean;
  /** Shopify does not track this product's stock: it sells there whatever the number says. */
  untracked: boolean;
  /** Shopify: the product is a draft or archived there. */
  draft: string | null;
  accountId: string | null;
}

const EMPTY: Omit<MarketplaceCell, 'kind'> = { shown: [], want: null, reason: null, activateId: null, held: false, untracked: false, draft: null, accountId: null };

/** How a product stands on one marketplace, from every listing it has there (usually one). */
export function cellFor(listings: ListingForCell[], stock: number, isLive: (accountId: string) => boolean): MarketplaceCell {
  if (listings.length === 0) return { ...EMPTY, kind: 'none' };
  const present = listings.filter((l) => l.listingStatus !== GONE);
  if (present.length === 0) return { ...EMPTY, kind: 'gone', accountId: listings[0].accountId };

  // Offers that sell, or would with stock. An old ended duplicate next to a live offer is not what the product "is" there.
  const live = present.filter((l) => l.active || l.soldOut);
  if (live.length === 0) {
    const first = present[0];
    const sellable = desiredQuantity({ stock, stockMode: first.stockMode, fixedQty: first.fixedQty, stockLocked: first.stockLocked }) ?? 0;
    const sending = isLive(first.accountId);
    return { ...EMPTY, kind: 'off', reason: first.listingStatus, accountId: first.accountId, held: !sending, activateId: sellable > 0 && sending ? first.id : null };
  }

  const first = live[0];
  const held = !isLive(first.accountId);
  const status = first.listingStatus?.toUpperCase() ?? '';
  const common: Omit<MarketplaceCell, 'kind'> = {
    ...EMPTY,
    shown: live.map((l) => (l.active ? marketplaceQuantity(l) : 0)),
    untracked: live.some((l) => l.ref.tracked === 0),
    draft: first.marketplace === 'shopify' && (status === 'DRAFT' || status === 'ARCHIVED') ? status.toLowerCase() : null,
    accountId: first.accountId,
    held,
  };
  if (live.every((l) => l.stockLocked)) return { ...common, kind: 'locked', reason: first.stockLocked };

  let kind: CellKind = 'manual';
  let want: number | null = null;
  let reason: string | null = null;
  for (const l of live) {
    const wanted = desiredQuantity({ stock, ...l });
    if (wanted === null) continue;
    if (kind === 'manual') kind = 'ok';
    want ??= wanted;
    const has = l.active ? marketplaceQuantity(l) : 0;
    // A refusal recorded while nothing is being sent is old news: it says nothing about what happens next.
    if (l.lastPushError && !held) {
      kind = 'error';
      reason ??= l.lastPushError;
      want = wanted;
    } else if (has !== wanted && kind !== 'error') {
      kind = 'differs';
      want = wanted;
    }
  }
  return { ...common, kind, want, reason };
}

/** Which of the page's filters a product falls under. */
export function productFlags(cells: MarketplaceCell[], stock: number): Record<Exclude<InventoryFilter, 'all'>, boolean> {
  return {
    out: stock <= 0,
    low: stock > 0 && stock < LOW_STOCK,
    differs: cells.some((c) => c.kind === 'differs' || c.kind === 'error'),
    off: stock > 0 && cells.some((c) => c.kind === 'off'),
  };
}
