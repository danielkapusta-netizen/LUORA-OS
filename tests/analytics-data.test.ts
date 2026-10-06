// Phase 1 of analytics: the money data captured from each marketplace (discounts, fees, refunds),
// the history import steps, exchange-rate gaps and the product cost import helpers.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import allegroForm from './fixtures/allegro/checkout-form.json';
import empikOrder from './fixtures/empik/order.json';
import shopifyOrder from './fixtures/shopify/order.json';
import { AllegroAdapter, allegroFeeKind } from '@/server/integrations/marketplaces/allegro/adapter';
import type { AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { mapAllegroCheckoutForm } from '@/server/integrations/marketplaces/allegro/mapper';
import { EmpikAdapter } from '@/server/integrations/marketplaces/empik/adapter';
import { mapMiraklOrder } from '@/server/integrations/marketplaces/empik/mapper';
import { ShopifyAdapter } from '@/server/integrations/marketplaces/shopify/adapter';
import { mapShopifyOrder } from '@/server/integrations/marketplaces/shopify/mapper';
import { createProductResolver, parseAmount, parseCostLines } from '@/server/services/costs';
import { feeSyncError } from '@/server/services/fees';
import { missingRanges } from '@/server/services/fx';
import { belongsToHistory } from '@/server/services/history';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const ALLEGRO = 'https://api.allegro.pl.allegrosandbox.pl';
const SHOP = 'https://luora.myshopify.com';
const EMPIK = 'https://marketplace.empik.test';

function allegroStore() {
  let current: AllegroCredentials = {
    clientId: 'cid',
    clientSecret: 'secret',
    sandbox: true,
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  };
  return { get: () => current, save: async (n: AllegroCredentials) => void (current = n) };
}

const shopifyStore = () => {
  const current = { shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' };
  return { get: () => current, save: async () => undefined };
};

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: 'PLN' } });

describe('Shopify money data', () => {
  const withMoney = {
    ...shopifyOrder,
    totalDiscountsSet: money('10.00'),
    lineItems: {
      nodes: shopifyOrder.lineItems.nodes.map((li, i) => ({ ...li, totalDiscountSet: money(i === 0 ? '10.00' : '0.00') })),
    },
    refunds: [
      {
        id: 'gid://shopify/Refund/1',
        createdAt: '2026-09-25T10:00:00Z',
        totalRefundedSet: money('52.98'),
        refundLineItems: {
          nodes: [{ quantity: 1, restockType: 'RETURN', lineItem: { id: 'gid://shopify/LineItem/1' }, subtotalSet: { shopMoney: { amount: '39.99' } } }],
        },
      },
    ],
    transactions: [
      { id: 't1', kind: 'SALE', status: 'SUCCESS', processedAt: '2026-09-20T10:00:00Z', fees: [{ id: 'fee-1', amount: { amount: '3.57', currencyCode: 'PLN' }, taxAmount: { amount: '0.67', currencyCode: 'PLN' }, type: 'PAYMENT' }] },
      { id: 't2', kind: 'SALE', status: 'FAILURE', processedAt: '2026-09-20T09:00:00Z', fees: [{ id: 'fee-x', amount: { amount: '9.99', currencyCode: 'PLN' }, type: 'PAYMENT' }] },
    ],
  };

  it('keeps line and order discounts, ignoring zero ones', () => {
    const o = mapShopifyOrder(withMoney);
    expect(o.discountAmount).toBe('10.00');
    expect(o.items.map((i) => i.discountAmount)).toEqual(['10.00', null]);
  });

  it('splits a refund into the returned line and the rest (shipping), and reads fees of successful payments only', () => {
    const o = mapShopifyOrder(withMoney);
    expect(o.refunds).toEqual([
      expect.objectContaining({ externalId: 'gid://shopify/Refund/1:gid://shopify/LineItem/1', externalLineId: 'gid://shopify/LineItem/1', amount: '39.99', quantity: 1, restocked: true }),
      expect.objectContaining({ externalId: 'gid://shopify/Refund/1', amount: '12.99' }),
    ]);
    expect(o.fees).toEqual([expect.objectContaining({ externalId: 'fee-1', kind: 'payment', amount: '3.57', taxAmount: '0.67' })]);
  });

  it('reads past orders newest first and keeps its place between steps', async () => {
    const seen: { after: string | null; query: string }[] = [];
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, async ({ request }) => {
        const body = (await request.json()) as { query: string; variables: { after: string | null; query: string } };
        expect(body.query).toContain('sortKey: CREATED_AT, reverse: true');
        seen.push({ after: body.variables.after, query: body.variables.query });
        const first = body.variables.after === null;
        return HttpResponse.json({
          data: { orders: { pageInfo: { hasNextPage: first, endCursor: first ? 'c1' : 'c2' }, nodes: [shopifyOrder] } },
        });
      }),
    );
    const adapter = new ShopifyAdapter(shopifyStore());
    const step = await adapter.syncHistory(JSON.stringify({ before: '2026-10-01T00:00:00.000Z', after: null }));
    expect(step.orders).toHaveLength(2);
    expect(step.hasMore).toBe(false);
    expect(step.nextCursor).toBeNull();
    expect(seen).toEqual([
      { after: null, query: "created_at:<='2026-10-01T00:00:00.000Z'" },
      { after: 'c1', query: "created_at:<='2026-10-01T00:00:00.000Z'" },
    ]);
  });
});

describe('Allegro money data', () => {
  it('derives the discount from the original price', () => {
    // originalPrice 59.00, paid 57.23, two units.
    expect(mapAllegroCheckoutForm(allegroForm).discountAmount).toBe('3.54');
    const full = { ...allegroForm, lineItems: allegroForm.lineItems.map((li) => ({ ...li, originalPrice: li.price })) };
    expect(mapAllegroCheckoutForm(full).discountAmount).toBeNull();
  });

  it('sorts billing types into fee kinds', () => {
    expect(allegroFeeKind('SUC', 'Prowizja od sprzedaży')).toBe('commission');
    expect(allegroFeeKind('ZWP', 'Zwrot prowizji')).toBe('commission');
    expect(allegroFeeKind('DXP', 'Opłata za dostawę Allegro Smart!')).toBe('delivery');
    expect(allegroFeeKind('FEA', 'Opłata za wyróżnienie')).toBe('promotion');
    expect(allegroFeeKind('ADS', 'Allegro Ads – kampania')).toBe('promotion');
    expect(allegroFeeKind('XYZ', 'Abonament')).toBe('other');
  });

  it('reads billing entries and payment refunds for a window, as positive costs', async () => {
    const queries: string[] = [];
    server.use(
      http.get(`${ALLEGRO}/billing/billing-entries`, ({ request }) => {
        queries.push(new URL(request.url).search);
        return HttpResponse.json({
          billingEntries: [
            { id: 'b1', occurredAt: '2026-09-21T10:00:00Z', type: { id: 'SUC', name: 'Prowizja od sprzedaży' }, value: { amount: '-12.30', currency: 'PLN' }, tax: { percentage: '23.00' }, order: { id: 'form-1' } },
            { id: 'b2', occurredAt: '2026-09-22T10:00:00Z', type: { id: 'REF', name: 'Zwrot prowizji' }, value: { amount: '4.10', currency: 'PLN' }, order: { id: 'form-1' } },
            { id: 'b3', occurredAt: '2026-09-22T10:00:00Z', type: { id: 'LIS', name: 'Opłata za wystawienie' }, value: { amount: '-1.00', currency: 'PLN' } },
          ],
        });
      }),
      http.get(`${ALLEGRO}/payments/refunds`, () =>
        HttpResponse.json({
          refunds: [
            {
              id: 'r1',
              status: 'SUCCESS',
              createdAt: '2026-09-23T10:00:00Z',
              order: { id: 'form-1' },
              lineItems: [{ id: 'line-1', type: 'QUANTITY', quantity: 1 }],
              totalValue: { amount: '57.23', currency: 'PLN' },
            },
            {
              id: 'r2',
              status: 'SUCCESS',
              createdAt: '2026-09-23T11:00:00Z',
              order: { id: 'form-2' },
              lineItems: [{ id: 'line-9', type: 'AMOUNT', value: { amount: '20.00', currency: 'PLN' } }],
              totalValue: { amount: '29.99', currency: 'PLN' },
            },
            { id: 'r3', status: 'FAILED', createdAt: '2026-09-23T12:00:00Z', order: { id: 'form-3' }, totalValue: { amount: '5.00', currency: 'PLN' } },
          ],
        }),
      ),
    );
    const adapter = new AllegroAdapter(allegroStore());
    const feed = await adapter.syncFees(new Date('2026-09-20T00:00:00Z'), new Date('2026-09-27T00:00:00Z'));
    expect(queries[0]).toContain('occurredAt.gte=2026-09-20T00%3A00%3A00.000Z');
    expect(feed.unattached).toBe(1);
    expect(feed.fees).toEqual([
      expect.objectContaining({ orderExternalId: 'form-1', externalId: 'b1', kind: 'commission', amount: '12.30', taxAmount: '2.30' }),
      expect.objectContaining({ orderExternalId: 'form-1', externalId: 'b2', kind: 'commission', amount: '-4.10', taxAmount: null }),
    ]);
    expect(feed.refunds).toEqual([
      // Only a quantity: the service values it from the order line.
      expect.objectContaining({ orderExternalId: 'form-1', externalId: 'r1:line-1', externalLineId: 'line-1', amount: null, quantity: 1 }),
      expect.objectContaining({ orderExternalId: 'form-2', externalId: 'r2:line-9', amount: '20.00', quantity: null }),
      // Delivery refunded on top of the line.
      expect.objectContaining({ orderExternalId: 'form-2', externalId: 'r2', amount: '9.99' }),
    ]);
  });

  it('explains a missing billing permission', () => {
    expect(feeSyncError(new Error('HTTP 403 from api.allegro.pl/billing/billing-entries: forbidden'))).toMatch(/Billing \(read\)/);
    expect(feeSyncError(new Error('timeout'))).toBe('timeout');
  });

  it('reads past checkout forms in date windows, skipping unpaid ones', async () => {
    const calls: Record<string, string | null>[] = [];
    const form = (id: string, status: string, boughtAt: string) => ({
      ...allegroForm,
      id,
      status,
      lineItems: allegroForm.lineItems.map((li) => ({ ...li, boughtAt })),
    });
    server.use(
      http.get(`${ALLEGRO}/order/checkout-forms`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        calls.push({ lte: q.get('lineItems.boughtAt.lte'), offset: q.get('offset'), sort: q.get('sort') });
        const forms = Array.from({ length: 100 }, (_, i) =>
          form(`f-${q.get('offset')}-${i}`, i === 0 ? 'BOUGHT' : 'READY_FOR_PROCESSING', `2026-0${q.get('offset') === '0' ? 9 : 8}-01T10:00:00.000Z`),
        );
        return HttpResponse.json({ checkoutForms: q.get('offset') === '100' ? forms.slice(0, 10) : forms, totalCount: 110 });
      }),
    );
    const adapter = new AllegroAdapter(allegroStore());
    const step = await adapter.syncHistory('2026-10-01T00:00:00.000Z');
    expect(calls).toEqual([
      { lte: '2026-10-01T00:00:00.000Z', offset: '0', sort: '-lineItems.boughtAt' },
      { lte: '2026-10-01T00:00:00.000Z', offset: '100', sort: '-lineItems.boughtAt' },
    ]);
    expect(step.orders).toHaveLength(99 + 9);
    expect(step).toMatchObject({ hasMore: false, nextCursor: null });
  });
});

describe('Empik money data', () => {
  const line = empikOrder.order_lines[0];
  const withMoney = {
    ...empikOrder,
    order_lines: [
      {
        ...line,
        origin_unit_price: line.price_unit + 5,
        commission_fee: 10,
        commission_vat: 2.3,
        total_commission: 12.3,
        refunds: [
          { id: 77, amount: line.price_unit, shipping_amount: 0, quantity: 1, commission_total_amount: 6.15, commission_vat: 1.15, created_date: '2026-09-25T10:00:00Z', state: 'REFUNDED' },
          { id: 78, amount: 5, quantity: 0, commission_total_amount: 1, created_date: '2026-09-26T10:00:00Z', state: 'WAITING_REFUND' },
        ],
      },
    ],
  };

  it('reads Empik commission per line and the commission given back on settled refunds', () => {
    const o = mapMiraklOrder(withMoney);
    expect(o.fees).toEqual([
      expect.objectContaining({ kind: 'commission', externalLineId: line.order_line_id, amount: '12.30', taxAmount: '2.30' }),
      expect.objectContaining({ kind: 'commission', amount: '-6.15', taxAmount: '-1.15' }),
    ]);
    expect(o.refunds).toEqual([expect.objectContaining({ externalLineId: line.order_line_id, quantity: 1, amount: line.price_unit.toFixed(2) })]);
    expect(o.items[0].discountAmount).toBe((5 * line.quantity).toFixed(2));
  });

  it('reads past orders newest first by creation date', async () => {
    const offsets: (string | null)[] = [];
    server.use(
      http.get(`${EMPIK}/api/orders`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        expect(q.get('end_date')).toBe('2026-10-01T00:00:00.000Z');
        expect(q.get('order')).toBe('desc');
        offsets.push(q.get('offset'));
        return HttpResponse.json({ orders: [empikOrder, { ...empikOrder, order_state: 'STAGING' }], total_count: 3 });
      }),
    );
    const adapter = new EmpikAdapter({ baseUrl: EMPIK, apiKey: 'k' });
    const step = await adapter.syncHistory(JSON.stringify({ before: '2026-10-01T00:00:00.000Z', offset: 0 }));
    expect(offsets).toEqual(['0', '2']);
    expect(step.orders).toHaveLength(2);
    expect(step.hasMore).toBe(false);
  });
});

describe('history import', () => {
  const account = { settings: { initialSyncDays: 14 } };
  const now = new Date('2026-10-06T12:00:00Z');
  const order = (daysAgo: number, flags: { cancelled?: boolean; fulfilled?: boolean } = {}) =>
    ({ ...mapAllegroCheckoutForm(allegroForm), cancelled: false, fulfilled: false, ...flags, placedAt: new Date(now.getTime() - daysAgo * 86_400_000) }) as never;

  it('leaves recent open orders to the regular sync', () => {
    expect(belongsToHistory(order(3), account, now)).toBe(false);
    expect(belongsToHistory(order(3, { fulfilled: true }), account, now)).toBe(true);
    expect(belongsToHistory(order(3, { cancelled: true }), account, now)).toBe(true);
    expect(belongsToHistory(order(40), account, now)).toBe(true);
  });
});

describe('exchange rates', () => {
  it('finds the ranges that were never fetched', () => {
    expect(missingRanges([], '2026-09-01', '2026-09-30')).toEqual([['2026-09-01', '2026-09-30']]);
    // Weekends are short gaps and don't count; a month-long hole does.
    const september = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-07', '2026-09-08'];
    expect(missingRanges(september, '2026-09-01', '2026-09-08')).toEqual([]);
    expect(missingRanges(september, '2026-09-01', '2026-09-30')).toEqual([['2026-09-09', '2026-09-30']]);
    expect(missingRanges(['2026-09-20'], '2026-09-01', '2026-09-21')).toEqual([['2026-09-01', '2026-09-19']]);
  });
});

describe('product cost import', () => {
  it('parses amounts written the Polish or English way', () => {
    expect(parseAmount('12,50')).toBe(12.5);
    expect(parseAmount('1 234,5 zł')).toBe(1234.5);
    expect(parseAmount('1,234.50')).toBe(1234.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('abc')).toBeNull();
  });

  it('reads pasted rows with tabs, semicolons or commas and skips a header', () => {
    expect(parseCostLines('Product\tCost\nLUO-MUG-01\t18,40\n5901234567890;22.10\nCOSRX Snail Mucin 96 Essence 100 ml, 31.50\n\n;5')).toEqual([
      { key: 'LUO-MUG-01', cost: 18.4 },
      { key: '5901234567890', cost: 22.1 },
      { key: 'COSRX Snail Mucin 96 Essence 100 ml', cost: 31.5 },
    ]);
  });

  it('matches a line to a product by SKU, EAN, or a clear name match', () => {
    const resolve = createProductResolver([
      { id: 'p1', sku: 'LUO-MUG-01', name: 'Kubek ceramiczny Luora 350 ml', ean: '5901234567890' },
      { id: 'p2', sku: 'CX-SNAIL-100', name: 'COSRX Advanced Snail 96 Mucin Power Essence 100 ml', ean: null },
      { id: 'p3', sku: 'ANUA-TONER-250', name: 'Anua Heartleaf 77% Soothing Toner 250 ml', ean: null },
    ]);
    expect(resolve('luo-mug-01')).toBe('p1');
    expect(resolve('05901234567890')).toBe('p1');
    expect(resolve('COSRX Advanced Snail 96 Mucin Power Essence 100 ml (18505316304) 1 sztuka')).toBe('p2');
    expect(resolve('Something else entirely')).toBeNull();
  });
});
