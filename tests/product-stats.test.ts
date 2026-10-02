import { describe, expect, it } from 'vitest';
import { normalizeEan } from '@/lib/sku';
import { rate } from '@/server/services/product-stats';

describe('normalizeEan', () => {
  it('keeps digits, folds a 14-digit GTIN with a leading 0, and rejects non-barcodes', () => {
    expect(normalizeEan(' 8809 6525-80050 ')).toBe('8809652580050');
    expect(normalizeEan('08809652580050')).toBe('8809652580050');
    expect(normalizeEan('')).toBeNull();
    expect(normalizeEan('12')).toBeNull();
    expect(normalizeEan(null)).toBeNull();
  });
});

describe('rate', () => {
  const t = (units: number, byMarketplace: Record<string, number> = {}) => ({ units, orders: units, revenue: units * 10, byMarketplace });
  it('ranks by units (ties share a rank), per platform too, and rates against the other sellers', () => {
    const out = rate(
      new Map([
        ['a', t(10, { allegro: 7, empik: 3 })],
        ['b', t(10, { allegro: 10 })],
        ['c', t(4, { empik: 4 })],
        ['d', t(1, { shopify: 1 })],
        ['e', t(0)],
      ]),
    );
    expect(out.get('a')).toMatchObject({ rank: 1, level: 'excellent', percentile: 1, rankByMarketplace: { allegro: 2, empik: 2 } });
    expect(out.get('b')).toMatchObject({ rank: 1, rankByMarketplace: { allegro: 1 } });
    expect(out.get('c')).toMatchObject({ rank: 3, level: 'good', percentile: 0.5, rankByMarketplace: { empik: 1 } });
    expect(out.get('d')).toMatchObject({ rank: 4, level: 'good', percentile: 0.25 });
    expect(out.get('e')).toMatchObject({ rank: null, level: 'none', percentile: 0, rankByMarketplace: {} });
  });
});
