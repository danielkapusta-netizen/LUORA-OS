import { describe, expect, it } from 'vitest';
import { shopClock } from '@/lib/analytics/window';
import { attentionOf, breakdownOf, byMarketplace, byOrder, byProduct, changePct, hourly, marginWord, totalsOf, upTo, type DailyLine } from '@/lib/daily/compute';

let seq = 0;
function line(over: Partial<DailyLine> = {}): DailyLine {
  seq += 1;
  const placedAt = over.placedAt ?? Date.parse('2026-11-27T09:30:00Z');
  const clock = shopClock(placedAt);
  return {
    orderId: `o${seq}`,
    orderNumber: String(1000 + seq),
    marketplace: 'allegro',
    accountName: 'Main',
    placedAt,
    day: clock.day,
    hour: clock.hour,
    minuteOfDay: clock.minuteOfDay,
    status: 'new',
    buyerName: 'Anna',
    customerId: null,
    productKey: 'p:a',
    productId: 'a',
    analyticsKey: 'a',
    name: 'Serum',
    brand: null,
    imageUrl: null,
    quantity: 1,
    refundedQuantity: 0,
    gross: 123,
    net: 100,
    fees: 10,
    feesEstimated: false,
    cost: 40,
    costKnown: true,
    shipping: 5,
    delivery: 12,
    refunds: 0,
    profit: 100 - 10 - 40 + 5 - 12,
    ...over,
  };
}

describe('the shop clock (Warsaw)', () => {
  it('reads the wall clock in winter and summer time', () => {
    expect(shopClock(Date.parse('2026-11-27T10:05:00Z'))).toEqual({ day: '2026-11-27', hour: 11, minuteOfDay: 665 });
    expect(shopClock(Date.parse('2026-07-01T10:05:00Z'))).toEqual({ day: '2026-07-01', hour: 12, minuteOfDay: 725 });
    // 23:30 UTC on 27 Nov is already the 28th in Warsaw.
    expect(shopClock(Date.parse('2026-11-27T23:30:00Z')).day).toBe('2026-11-28');
  });

  it('keeps wall-clock hours across the change to summer time', () => {
    // 29 March 2026: clocks jump from 02:00 to 03:00.
    expect(shopClock(Date.parse('2026-03-29T00:30:00Z')).hour).toBe(1);
    expect(shopClock(Date.parse('2026-03-29T01:30:00Z')).hour).toBe(3);
  });
});

describe('daily figures', () => {
  it('adds up totals, average basket and margin', () => {
    const lines = [line({ orderId: 'x' }), line({ orderId: 'x', quantity: 2 }), line({ orderId: 'y' })];
    const totals = totalsOf(lines);
    expect(totals).toMatchObject({ orders: 2, units: 4, revenue: 369 });
    expect(totals.avgBasket).toBeCloseTo(184.5);
    expect(totals.marginPct).toBeCloseTo((43 * 3 * 100) / 369);
    expect(totalsOf([])).toEqual({ orders: 0, units: 0, revenue: 0, profit: 0, marginPct: null, avgBasket: null });
  });

  it('breaks revenue down to exactly the profit', () => {
    const lines = [line(), line({ refunds: 20, profit: 43 - 20 }), line({ shipping: 30, delivery: 10, profit: 100 - 10 - 40 + 30 - 10 })];
    const b = breakdownOf(lines);
    expect(b.revenue - b.vat - b.fees - b.cost - b.shipping - b.refunds).toBeCloseTo(b.profit);
    expect(b.vat).toBeCloseTo(69);
  });

  it('cuts a comparison day at the same minute of the day', () => {
    const early = line({ placedAt: Date.parse('2026-11-26T08:00:00Z') });
    const late = line({ placedAt: Date.parse('2026-11-26T15:00:00Z') });
    expect(upTo([early, late], shopClock(Date.parse('2026-11-27T10:05:00Z')).minuteOfDay)).toEqual([early]);
    expect(upTo([early, late], null)).toEqual([early, late]);
  });

  it('puts orders in their Warsaw hour, all 24 hours present', () => {
    const hours = hourly([line({ placedAt: Date.parse('2026-11-27T09:10:00Z'), orderId: 'a' }), line({ placedAt: Date.parse('2026-11-27T09:50:00Z'), orderId: 'a' }), line({ placedAt: Date.parse('2026-11-27T23:10:00Z') })]);
    expect(hours).toHaveLength(24);
    expect(hours[10]).toMatchObject({ hour: 10, revenue: 246, orders: 1 });
    expect(hours[0].orders).toBe(1);
  });

  it('rolls up per marketplace, product and order', () => {
    const lines = [
      line({ orderId: 'a', marketplace: 'shopify', placedAt: Date.parse('2026-11-27T08:00:00Z') }),
      line({ orderId: 'b', productKey: 'p:b', productId: 'b', name: 'Cream', costKnown: false, feesEstimated: true, placedAt: Date.parse('2026-11-27T09:00:00Z') }),
      line({ orderId: 'b', placedAt: Date.parse('2026-11-27T09:00:00Z') }),
    ];
    expect(byMarketplace(lines).map((m) => [m.marketplace, m.orders])).toEqual([
      ['allegro', 1],
      ['shopify', 1],
    ]);
    const products = byProduct(lines);
    expect(products.map((p) => [p.key, p.units, p.orders, p.costMissing])).toEqual([
      ['p:a', 2, 2, false],
      ['p:b', 1, 1, true],
    ]);
    expect(products[0].profitPerUnit).toBeCloseTo(43);
    expect(products[1].analyticsKey).toBe('a');
    const orders = byOrder(lines);
    expect(orders.map((o) => o.orderId)).toEqual(['b', 'a']);
    expect(orders[0]).toMatchObject({ units: 2, feesEstimated: true, costMissing: true });
  });

  it('lists what needs attention, most serious first, and nothing when all is well', () => {
    const orders = byOrder([line({ orderId: 'loss', profit: -15 }), line({ orderId: 'ok', feesEstimated: true })]);
    const products = byProduct([line({ costKnown: false })]);
    const items = attentionOf(orders, products, { cancelled: { count: 1, amount: 80 }, refunded: { count: 0, amount: 0 }, pending: 2 });
    expect(items.map((i) => i.kind)).toEqual(['loss', 'costMissing', 'pending', 'cancelled', 'feesEstimated']);
    expect(items[0]).toEqual({ kind: 'loss', count: 1, amount: -15 });
    expect(attentionOf(byOrder([line()]), byProduct([line()]), { cancelled: { count: 0, amount: 0 }, refunded: { count: 0, amount: 0 }, pending: 0 })).toEqual([]);
  });

  it('describes changes and margins', () => {
    expect(changePct(150, 100)).toBe(50);
    expect(changePct(10, 0)).toBeNull();
    expect(changePct(null, 10)).toBeNull();
    expect([marginWord(30), marginWord(8), marginWord(-2), marginWord(null)]).toEqual(['healthy', 'thin', 'loss', null]);
  });
});
