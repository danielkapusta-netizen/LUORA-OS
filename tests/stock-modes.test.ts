import { describe, expect, it } from 'vitest';
import { desiredQuantity, pendingUpdatesFor } from '@/server/services/inventory';

const row = (over: Partial<Parameters<typeof pendingUpdatesFor>[0][number]> = {}) => ({
  listingId: 'l1',
  externalId: 'x1',
  sku: null,
  ref: {},
  stock: 60,
  lastPushedQty: null,
  ...over,
});

describe('what a listing is sent', () => {
  it('follows the master stock by default and never goes below zero', () => {
    expect(desiredQuantity({ stock: 60 })).toBe(60);
    expect(desiredQuantity({ stock: -3 })).toBe(0);
  });

  it('sends nothing to an inactive listing or one managed on the marketplace', () => {
    expect(desiredQuantity({ stock: 60, active: false })).toBeNull();
    expect(desiredQuantity({ stock: 60, stockMode: 'off' })).toBeNull();
  });

  it('sends the fixed quantity, and nothing while it is not set', () => {
    expect(desiredQuantity({ stock: 60, stockMode: 'fixed', fixedQty: 5 })).toBe(5);
    expect(desiredQuantity({ stock: 60, stockMode: 'fixed', fixedQty: null })).toBeNull();
  });

  it('queues only the listings whose quantity differs', () => {
    const updates = pendingUpdatesFor([
      row({ listingId: 'same', lastPushedQty: 60 }),
      row({ listingId: 'new' }),
      row({ listingId: 'inactive', active: false }),
      row({ listingId: 'off', stockMode: 'off' }),
      row({ listingId: 'fixed', stockMode: 'fixed', fixedQty: 5, lastPushedQty: 60 }),
    ]);
    expect(updates.map((u) => [u.listingId, u.quantity])).toEqual([
      ['new', 60],
      ['fixed', 5],
    ]);
  });
});
