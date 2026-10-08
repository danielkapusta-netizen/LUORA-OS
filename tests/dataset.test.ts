import { describe, expect, it } from 'vitest';
import { groupOrders, toLineItem } from '@/server/analytics/dataset';

const row = (over: Record<string, unknown> = {}) =>
  ({
    itemId: 'i1',
    orderId: 'o1',
    marketplace: 'allegro',
    productId: 'p1',
    placedAt: Date.parse('2026-09-01T10:00:00Z'),
    currency: 'EUR',
    fxRate: 4.3,
    vatRate: 0.23,
    quantity: 2,
    gross: 86,
    fees: 8.6,
    feesEstimated: 0,
    cost: 30,
    costKnown: 1,
    shipping: 10,
    delivery: 14,
    profit: 27.3,
    unitPrice: '10.00',
    itemName: 'Anua Toner (offer 123)',
    sku: 'ANUA-1',
    productName: 'Anua Heartleaf 77% Soothing Toner – tonik 250 ml',
    brand: 'Anua',
    category: null,
    externalNumber: 'ABC123',
    buyerName: 'Anna Nowak',
    ...over,
  }) as never;

describe('analytics dataset', () => {
  it('maps a profit line to the domain line, in PLN with costs and fees', () => {
    const l = toLineItem(row());
    expect(l).toMatchObject({
      productKey: 'p1',
      rawSku: 'p1',
      productLabel: 'Anua Heartleaf 77% Soothing Toner – tonik 250 ml',
      qty: 2,
      revenuePLN: 86,
      commissionPLN: 8.6,
      shipmentPLN: 4,
      marginPLN: 27.3,
      source: 'allegro',
      costKnown: true,
      feesEstimated: false,
      brand: 'Anua',
      orderNumber: 'ABC123',
    });
    expect(l.commissionOriginal).toBeCloseTo(2);
    expect(l.marginPct).toBeCloseTo(31.74, 1);
  });

  it('keys a line without a product by its SKU, else its name', () => {
    expect(toLineItem(row({ productId: null })).productKey).toBe('item:anua-1');
    expect(toLineItem(row({ productId: null, sku: null })).productKey).toBe('item:anua toner (offer 123)');
    expect(toLineItem(row({ productId: null, productName: null })).productLabel).toBe('Anua Toner (offer 123)');
  });

  it('groups lines into orders by order id, newest first, keeping identical lines', () => {
    const lines = [
      toLineItem(row({ itemId: 'a', orderId: 'o1' })),
      toLineItem(row({ itemId: 'b', orderId: 'o1' })),
      toLineItem(row({ itemId: 'c', orderId: 'o2', placedAt: Date.parse('2026-09-05T10:00:00Z') })),
    ];
    const orders = groupOrders(lines);
    expect(orders.map((o) => o.id)).toEqual(['o2', 'o1']);
    expect(orders[1]).toMatchObject({ lineCount: 2, units: 4, revenuePLN: 172, hasSuspectedMissingLine: false });
  });
});
