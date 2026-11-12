import { describe, expect, it } from 'vitest';
import { brandKey, cellFor, groupByBrand, productFlags, sortProducts, type ListingForCell } from '@/lib/inventory-view';

const product = (name: string, brand: string | null, over: Partial<{ id: string; stock: number; createdAt: Date }> = {}) => ({ id: name, name, brand, stock: 5, createdAt: new Date('2026-01-01'), ...over });

const listing = (over: Partial<ListingForCell> = {}): ListingForCell => ({
  id: 'l1',
  accountId: 'acc',
  marketplace: 'allegro',
  active: true,
  soldOut: false,
  stockLocked: null,
  listingStatus: 'ACTIVE',
  stockMode: 'master',
  fixedQty: null,
  lastSeenQty: 20,
  lastSeenAt: new Date('2026-11-01'),
  lastPushedQty: null,
  lastPushedAt: null,
  lastPushError: null,
  ref: {},
  ...over,
});
const live = () => true;
const held = () => false;

describe('brands', () => {
  it('treats every spelling of a vendor as one brand', () => {
    expect(brandKey('ROUND LAB')).toBe(brandKey('Round  Lab'));
    expect(brandKey('Bioré')).toBe('biore');
    expect(brandKey('Dr. Jart+')).toBe('dr jart+');
  });

  it('groups by brand A to Z, names the group by its most common spelling, and puts products without a brand last', () => {
    const groups = groupByBrand([
      product('Zinc cream', null),
      product('Birch cream', 'Round Lab'),
      product('Birch toner', 'ROUND LAB'),
      product('Birch stick', 'ROUND LAB'),
      product('Eye patch', 'Abib'),
      product('NIDA Revive Eye Cream', null),
    ]);
    expect(groups.map((g) => [g.label, g.products.map((p) => p.name)])).toEqual([
      ['Abib', ['Eye patch']],
      // No vendor in Shopify: the brand is read from the name.
      ['NIDA', ['NIDA Revive Eye Cream']],
      ['ROUND LAB', ['Birch cream', 'Birch stick', 'Birch toner']],
      [null, ['Zinc cream']],
    ]);
  });

  it('sorts the flat lists', () => {
    const items = [product('B', null, { stock: 3, createdAt: new Date('2026-03-01') }), product('A', null, { stock: 9, createdAt: new Date('2026-02-01') }), product('C', null, { stock: 0, createdAt: new Date('2026-04-01') })];
    const units = (id: string) => ({ A: 1, B: 7, C: 7 })[id] ?? 0;
    const names = (sort: Parameters<typeof sortProducts>[1]) => sortProducts(items, sort, units).map((p) => p.name);
    expect(names('name')).toEqual(['A', 'B', 'C']);
    expect(names('stock')).toEqual(['C', 'B', 'A']);
    expect(names('new')).toEqual(['C', 'B', 'A']);
    expect(names('sales')).toEqual(['B', 'C', 'A']);
  });
});

describe('how a product stands on a marketplace', () => {
  it('is fine when the offer shows the stock, and differs when it does not', () => {
    expect(cellFor([listing()], 20, live)).toMatchObject({ kind: 'ok', shown: [20] });
    expect(cellFor([listing()], 18, live)).toMatchObject({ kind: 'differs', shown: [20], want: 18, held: false });
    expect(cellFor([], 20, live).kind).toBe('none');
  });

  it('shows a sold-out offer as waiting for its stock, not as switched off', () => {
    const soldOut = listing({ active: false, soldOut: true, listingStatus: 'ENDED', lastSeenQty: 0 });
    expect(cellFor([soldOut], 12, live)).toMatchObject({ kind: 'differs', shown: [0], want: 12, activateId: null });
    expect(cellFor([soldOut], 0, live)).toMatchObject({ kind: 'ok', shown: [0] });
  });

  it('offers Activate for an offer ended by hand, only when there is stock and the account is sent to', () => {
    const ended = listing({ active: false, listingStatus: 'ENDED', lastSeenQty: 0 });
    expect(cellFor([ended], 12, live)).toMatchObject({ kind: 'off', activateId: 'l1', reason: 'ENDED' });
    expect(cellFor([ended], 0, live)).toMatchObject({ kind: 'off', activateId: null });
    expect(cellFor([ended], 12, held)).toMatchObject({ kind: 'off', activateId: null, held: true });
    // A live offer next to an old ended duplicate is what counts.
    expect(cellFor([ended, listing({ id: 'l2' })], 20, live)).toMatchObject({ kind: 'ok', shown: [20] });
  });

  it('knows a bundle, a removed offer, one managed on the marketplace and a refusal', () => {
    expect(cellFor([listing({ stockLocked: 'bundle', marketplace: 'shopify' })], 3, live)).toMatchObject({ kind: 'locked', shown: [20] });
    expect(cellFor([listing({ active: false, listingStatus: 'GONE' })], 3, live).kind).toBe('gone');
    expect(cellFor([listing({ stockMode: 'off' })], 3, live).kind).toBe('manual');
    expect(cellFor([listing({ lastPushError: 'Invalid stock' })], 20, live)).toMatchObject({ kind: 'error', reason: 'Invalid stock' });
    // While nothing is sent to the account, an old refusal is not news.
    expect(cellFor([listing({ lastPushError: 'old' })], 20, held)).toMatchObject({ kind: 'ok', held: true });
  });

  it('notes what Shopify says about the product', () => {
    const shopify = listing({ marketplace: 'shopify', listingStatus: 'DRAFT', ref: { tracked: 0 } });
    expect(cellFor([shopify], 20, live)).toMatchObject({ kind: 'ok', untracked: true, draft: 'draft' });
  });

  it('files a product under the filters', () => {
    const off = cellFor([listing({ active: false, listingStatus: 'ENDED' })], 2, live);
    expect(productFlags([off], 2)).toEqual({ out: false, low: true, differs: false, off: true });
    expect(productFlags([cellFor([listing()], 0, live)], 0)).toEqual({ out: true, low: false, differs: true, off: false });
  });
});
