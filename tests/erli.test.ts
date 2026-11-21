// Erli.pl: the requests we send and how Erli's answers read (orders, change feed, tracking, stock, prices, offers).
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ErliAdapter, erliFeeKind, erliVendor } from '@/server/integrations/marketplaces/erli/adapter';
import { describeErliError } from '@/server/integrations/marketplaces/erli/client';
import { fromGrosze, mapErliOrder, toGrosze, type ErliOrder } from '@/server/integrations/marketplaces/erli/mapper';
import type { OfferDraft } from '@/server/integrations/marketplaces/types';
import { httpConfig } from '@/server/http';
import { erliAttributes } from '@/server/services/marketplace-offers';

const API = 'https://erli.pl/svc/shop-api';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  httpConfig.sleep = async () => {};
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const adapter = (settings = {}) => new ErliAdapter({ apiKey: 'test-key' }, settings);

const order: ErliOrder = {
  id: '123456x0001',
  status: 'purchased',
  sellerStatus: 'created',
  user: {
    email: 'proxy-1@erli.example',
    deliveryAddress: { firstName: 'Anna', lastName: 'Nowak', street: 'Marszałkowska', buildingNumber: '10', flatNumber: '5', city: 'Warszawa', country: 'pl', zip: '00-001', phone: '600700800' },
    invoiceAddress: { type: 'company', companyName: 'Nowak sp. z o.o.', nip: '525-000-00-00', street: 'Prosta', buildingNumber: '1', city: 'Warszawa', country: 'pl', zip: '00-002' },
  },
  items: [
    { id: 11, externalId: 'LUO-1', sku: 'LUO-1', ean: '5901234567890', quantity: 2, unitPrice: 4499, unitPriceBeforeRebate: 4999, name: 'Luora Night Cream 50 ml' },
  ],
  delivery: { name: 'InPost Paczkomaty 24/7', typeId: 'inpostParcelLocker', price: 1299, cod: false, pickupPlace: { externalId: 'KRA010M', provider: 'inpost' } },
  totalPrice: 10297,
  currency: 'PLN',
  created: '2026-11-20T10:00:00.000Z',
  purchasedAt: '2026-11-20T10:05:00.000Z',
  updated: '2026-11-20T10:05:00.000Z',
  cursor: 'c-1',
};

describe('Erli orders', () => {
  it('maps grosze, the locker, the invoice and the rebate', () => {
    const n = mapErliOrder(order);
    expect(n).toMatchObject({
      externalId: '123456x0001',
      readyToShip: true,
      cancelled: false,
      fulfilled: false,
      totalAmount: '102.97',
      shippingAmount: '12.99',
      discountAmount: '10.00',
      pickupPointId: 'KRA010M',
      deliveryMethodName: 'InPost Paczkomaty 24/7',
      codAmount: null,
      shippingAddress: { name: 'Anna Nowak', street: 'Marszałkowska 10/5', postalCode: '00-001', countryCode: 'PL', phone: '600700800' },
      invoiceRequest: { name: 'Nowak sp. z o.o.', taxId: '5250000000', street: 'Prosta 1', city: 'Warszawa' },
      items: [{ externalLineId: '11', sku: 'LUO-1', quantity: 2, unitPrice: '44.99', externalProductId: 'LUO-1' }],
    });
  });

  it('knows unpaid, cancelled, cash on delivery and sent orders', () => {
    expect(mapErliOrder({ ...order, status: 'pending' }).readyToShip).toBe(false);
    expect(mapErliOrder({ ...order, status: 'cancelled' }).cancelled).toBe(true);
    expect(mapErliOrder({ ...order, delivery: { ...order.delivery, cod: true } }).codAmount).toBe('102.97');
    expect(mapErliOrder({ ...order, sellerStatus: 'sent' }).fulfilled).toBe(true);
    expect(mapErliOrder({ ...order, user: { ...order.user, invoiceAddress: undefined } }).invoiceRequest).toBeNull();
  });

  it('imports recent orders first, then follows the change feed and marks messages read on the next call', async () => {
    const calls: string[] = [];
    let marked: unknown = null;
    server.use(
      http.post(`${API}/orders/_search`, async ({ request }) => {
        const body = (await request.json()) as { pagination: { order: string }; filter?: { field: string } };
        calls.push(`search ${body.pagination.order} ${body.filter?.field ?? ''}`);
        expect(request.headers.get('authorization')).toBe('Bearer test-key');
        return HttpResponse.json([order]);
      }),
      http.post(`${API}/orders/changes/_search`, () => {
        calls.push('changes');
        return HttpResponse.json([
          { id: 'm1', shopId: 1, created: '2026-11-20T11:00:00Z', read: false, type: 'orderStatusChanged', payload: { id: '123456x0001' } },
          { id: 'm2', shopId: 1, created: '2026-11-20T11:01:00Z', read: false, type: 'orderSellerStatusChanged', payload: { id: '123456x0001' } },
        ]);
      }),
      http.get(`${API}/orders/123456x0001`, () => HttpResponse.json({ ...order, status: 'cancelled' })),
      http.post(`${API}/orders/changes/mark-read`, async ({ request }) => {
        marked = await request.json();
        calls.push('mark-read');
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const a = adapter({ initialSyncDays: 7 });
    const first = await a.syncOrders(null);
    expect(first.orders.map((o) => o.externalId)).toEqual(['123456x0001']);
    expect(first.hasMore).toBe(false);
    const second = await a.syncOrders(first.nextCursor);
    expect(second.orders).toHaveLength(1);
    expect(second.orders[0].cancelled).toBe(true);
    expect(marked).toBeNull();
    const third = await a.syncOrders(second.nextCursor);
    expect(marked).toEqual({ lastMessageId: 'm2', ids: ['m1', 'm2'] });
    expect(third.orders).toHaveLength(1);
    expect(calls).toEqual(['search ASC created', 'changes', 'mark-read', 'changes']);
  });

  it('reports our InPost parcel and marks the order sent, once', async () => {
    const parcels: unknown[] = [];
    const statuses: unknown[] = [];
    let tracking: string | undefined;
    server.use(
      http.get(`${API}/orders/123456x0001`, () => HttpResponse.json({ ...order, deliveryTracking: tracking ? { status: 'sent', trackingNumber: tracking } : null, sellerStatus: tracking ? 'sent' : 'inProgress' })),
      http.post(`${API}/shipping/external`, async ({ request }) => {
        const body = (await request.json()) as { trackingNumber: string }[];
        parcels.push(body);
        tracking = body[0].trackingNumber;
        return HttpResponse.json([{ id: 1, orderId: '123456x0001', type: 'external', shipping: { vendor: 'inpost' }, status: 'sent' }]);
      }),
      http.patch(`${API}/orders/123456x0001/status`, async ({ request }) => {
        statuses.push(await request.json());
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const ref = { externalId: '123456x0001', externalNumber: '123456x0001', raw: order, items: [] };
    const info = { carrier: 'inpost' as const, carrierName: 'InPost', trackingNumber: '520000012345678901234567' };
    await adapter().pushTracking(ref, info);
    await adapter().pushTracking(ref, info);
    expect(parcels).toEqual([[{ orderId: '123456x0001', vendor: 'inpost', trackingNumber: '520000012345678901234567' }]]);
    expect(statuses).toEqual([{ status: 'sent' }]);
  });

  it('names carriers the way Erli does', () => {
    expect(erliVendor({ carrier: 'inpost', carrierName: 'InPost', trackingNumber: 'x' })).toBe('inpost');
    expect(erliVendor({ carrier: 'allegro_shipping', carrierCode: 'DPD', carrierName: 'DPD Polska', trackingNumber: 'x' })).toBe('dpd');
    expect(erliVendor({ carrier: 'allegro_shipping', carrierName: 'ORLEN Paczka', trackingNumber: 'x' })).toBe('orlen');
  });
});

describe('Erli products', () => {
  it('lists the offers, page by page, skipping archived ones', async () => {
    const afters: (string | undefined)[] = [];
    server.use(
      http.post(`${API}/products/_search`, async ({ request }) => {
        const body = (await request.json()) as { pagination: { after?: string }; fields: string[] };
        afters.push(body.pagination.after);
        // Like Erli: only the fields asked for come back.
        const only = (p: Record<string, unknown>) => Object.fromEntries(Object.entries(p).filter(([k]) => body.fields.includes(k)));
        if (!body.pagination.after) {
          return HttpResponse.json(
            Array.from({ length: 200 }, (_, i) => only({ externalId: `P${String(i).padStart(3, '0')}`, name: `Product ${i}`, stock: i, price: 1999, status: i % 2 ? 'active' : 'inactive', archived: i === 5 })),
          );
        }
        return HttpResponse.json([only({ externalId: 'Z1', name: 'Last', ean: '5900000000001', stock: 3, price: 4999, status: 'active' })]);
      }),
    );
    const listings = [];
    for await (const l of adapter().listListings()) listings.push(l);
    expect(listings).toHaveLength(200);
    expect(afters).toEqual([undefined, 'P199']);
    expect(listings.find((l) => l.externalId === 'P005')).toBeUndefined();
    expect(listings.find((l) => l.externalId === 'P002')).toMatchObject({ active: false, quantity: 2, price: '19.99' });
    expect(listings.at(-1)).toMatchObject({ externalId: 'Z1', ean: '5900000000001', price: '49.99', active: true, ref: { externalId: 'Z1' } });
  });

  it('sends stock and prices in batches and reports refused products alone', async () => {
    const bodies: unknown[] = [];
    server.use(
      http.patch(`${API}/products/batch-update`, async ({ request }) => {
        const body = (await request.json()) as { externalId: string }[];
        bodies.push(body);
        return HttpResponse.json(
          body.map((b) => (b.externalId === 'GONE' ? { externalId: 'GONE', status: 404, error: { name: 'NotFound', message: 'Product not found' } } : { externalId: b.externalId, status: 202, result: { updatedFields: ['stock'] } })),
        );
      }),
    );
    const failures = await adapter().setStock([
      { externalId: 'LUO-1', sku: 'LUO-1', ref: {}, quantity: 4 },
      { externalId: 'GONE', sku: null, ref: {}, quantity: -2 },
    ]);
    expect(bodies[0]).toEqual([{ externalId: 'LUO-1', stock: 4 }, { externalId: 'GONE', stock: 0 }]);
    expect(failures).toEqual([{ externalId: 'GONE', message: 'Erli (HTTP 404): Product not found', gone: true }]);
    await adapter().setPrices([{ externalId: 'LUO-1', sku: 'LUO-1', ean: null, ref: {}, price: '49.99', currency: 'PLN' }]);
    expect(bodies[1]).toEqual([{ externalId: 'LUO-1', price: 4999 }]);
  });

  const draft: OfferDraft = {
    sku: 'LUO-1',
    ean: '5901234567890',
    name: 'Luora Night Cream 50 ml',
    descriptionHtml: '<h3>Use</h3><p>Rich <strong>night</strong> cream</p>',
    brand: 'Luora',
    imageUrls: ['https://cdn.shopify.com/a.jpg', 'https://cdn.shopify.com/b.jpg'],
    weightGrams: 120,
    quantity: 7,
    price: '54.99',
    currency: 'PLN',
    responsiblePersonId: '12',
    responsibleProducerId: '34',
    erli: {
      category: { source: 'allegro', id: '257689' },
      attributes: [{ source: 'allegro', id: '17448', type: 'number', values: [50] }],
      allegroProductId: 'allegro-prod-1',
    },
  };

  it('creates the product with the Allegro category, details and our content', async () => {
    let path = '';
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/products/:id`, async ({ request, params }) => {
        path = String(params.id);
        body = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const result = await adapter({ offerHandlingDays: 2, erliPriceList: 'kosmetyki', erliCreateInactive: true, erliTaxRate: 'TAX_23' }).createOffer(draft);
    expect(result).toEqual({ externalId: 'LUO-1', note: 'Erli is processing the product (up to 20 minutes)' });
    expect(path).toBe('LUO-1');
    expect(body).toEqual({
      name: 'Luora Night Cream 50 ml',
      ean: '5901234567890',
      sku: 'LUO-1',
      description: { sections: [{ items: [{ type: 'TEXT', content: '<h2>Use</h2><p>Rich <b>night</b> cream</p>' }] }] },
      images: [{ url: 'https://cdn.shopify.com/a.jpg' }, { url: 'https://cdn.shopify.com/b.jpg' }],
      price: 5499,
      stock: 7,
      status: 'inactive',
      dispatchTime: { period: 2 },
      deliveryPriceList: 'kosmetyki',
      weight: 120,
      taxRate: 'TAX_23',
      externalCategories: [{ source: 'allegro', breadcrumb: [{ id: '257689' }] }],
      externalAttributes: [{ source: 'allegro', id: '17448', type: 'number', values: [50] }],
      externalReferences: [{ id: 'allegro-prod-1', kind: 'allegro' }],
      responsiblePersonId: 12,
      producerId: 34,
    });
  });

  it('links a product that already exists, sends the Shopify type without an Allegro category, and refuses bad drafts', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/products/:id`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json([{ errorCode: 1500, errorMessage: 'Produkt już istnieje' }], { status: 409 });
      }),
    );
    const result = await adapter().createOffer({ ...draft, sku: draft.ean, erli: { category: { source: 'shop', name: 'Kremy' }, attributes: [] } });
    expect(result).toEqual({ externalId: draft.ean, note: 'already on Erli, linked' });
    expect(body.externalCategories).toEqual([{ source: 'shop', breadcrumb: [{ id: 'Kremy', name: 'Kremy' }] }]);
    expect(body.sku).toBeUndefined();
    expect(body.status).toBe('active');
    await expect(adapter().createOffer({ ...draft, imageUrls: [] })).rejects.toThrow('at least one photo');
    await expect(adapter().createOffer({ ...draft, name: 'Cream' })).rejects.toThrow('title too short');
  });

  it('turns Allegro parameters into Erli attributes', () => {
    const params = [
      { id: '248811', name: 'Marka', type: 'dictionary' as const, unit: null, required: true, requiredForProduct: true, describesProduct: true },
      { id: '17448', name: 'Pojemność', type: 'float' as const, unit: 'ml', required: true, requiredForProduct: true, describesProduct: true },
      { id: '225693', name: 'EAN (GTIN)', type: 'string' as const, unit: null, required: false, requiredForProduct: true, describesProduct: true },
    ];
    expect(
      erliAttributes(params, [
        { id: '248811', valuesIds: ['b1'] },
        { id: '248811', valuesIds: ['b9'], values: ['Nida'] },
        { id: '17448', values: ['50'] },
        { id: '225693', values: ['5901234567890'] },
        { id: 'unknown', values: ['x'] },
      ]),
    ).toEqual([
      { source: 'allegro', id: '248811', type: 'dictionary', values: [{ id: 'b1' }] },
      { source: 'allegro', id: '17448', type: 'number', values: [50] },
      { source: 'allegro', id: '225693', type: 'string', values: ['5901234567890'] },
    ]);
  });
});

describe('Erli account', () => {
  it('names the shop and warns about missing permissions', async () => {
    server.use(http.get(`${API}/me`, () => HttpResponse.json({ id: 1, name: 'Luora', active: true, scopes: ['product', 'order:read'], markets: ['pl'] })));
    expect(await adapter().checkConnection()).toBe('Erli: Luora (the API key lacks: order)');
  });

  it('reads fees per order from billing', async () => {
    server.use(
      http.post(`${API}/billing/company/entries`, () =>
        HttpResponse.json([
          { id: 3, occurredAt: '2026-11-20T12:00:00Z', type: 'commission', description: 'Prowizja od sprzedaży', amount: -1030, balanceAfter: 0, orderId: '123456x0001', currency: 'PLN', market: 'pl' },
          { id: 2, occurredAt: '2026-11-20T12:00:00Z', type: 'payout', description: 'Wypłata', amount: 50000, balanceAfter: 0, currency: 'PLN', market: 'pl' },
        ]),
      ),
    );
    const feed = await adapter().syncFees(new Date('2026-11-20'), new Date('2026-11-21'));
    expect(feed.fees).toEqual([
      { orderExternalId: '123456x0001', externalId: '3', kind: 'commission', label: 'Prowizja od sprzedaży', amount: '10.30', taxAmount: '1.93', currency: 'PLN', occurredAt: new Date('2026-11-20T12:00:00Z') },
    ]);
    expect(feed.unattached).toBe(1);
    expect(erliFeeKind('deliveryFee', 'Opłata za dostawę')).toBe('delivery');
  });

  it('reads Erli errors and converts amounts', () => {
    expect(describeErliError('[{"errorCode":1200,"errorMessage":"Nieprawidłowy EAN"}]')).toBe('Nieprawidłowy EAN');
    expect(describeErliError('{"message":"Forbidden","polishMessage":"Brak uprawnień","payload":{"details":"scope order"}}')).toBe('Brak uprawnień – scope order');
    expect([fromGrosze(4999), toGrosze('49.99'), toGrosze('0.1')]).toEqual(['49.99', 4999, 10]);
  });
});
