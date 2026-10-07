import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { VonHalskyAdapter, imageFileNames } from '@/server/integrations/marketplaces/vonhalsky/adapter';
import {
  VonHalskyApiError,
  VonHalskyClient,
  exchangeVonHalskyCode,
  pkcePair,
  vonHalskyAuthorizeUrl,
  type VonHalskyCredentials,
} from '@/server/integrations/marketplaces/vonhalsky/client';
import { isImportable, mapVonHalskyOrder, vonHalskyOrderSchema } from '@/server/integrations/marketplaces/vonhalsky/mapper';
import { httpConfig } from '@/server/http';
import { offerPrice, suggestCategory } from '@/server/services/vonhalsky-offers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  httpConfig.sleep = async () => {};
});

const ORG = '5b0e6b0a-6f5c-4a43-9a53-0d2f9d7a1111';
const API = `https://stage-api.inpost-group.com/inpsa/v1/organizations/${ORG}`;
const TOKEN_URL = 'https://stage-account.inpost-group.com/oauth2/token';

function store(overrides: Partial<VonHalskyCredentials> = {}) {
  let current: VonHalskyCredentials = { organizationId: ORG, clientId: 'cid', clientSecret: 'secret', sandbox: true, ...overrides };
  const saved: VonHalskyCredentials[] = [];
  return { saved, get: () => current, save: async (n: VonHalskyCredentials) => void saved.push((current = n)) };
}

const tokenHandler = (counter?: { n: number; body?: URLSearchParams; auth?: string | null }) =>
  http.post(TOKEN_URL, async ({ request }) => {
    if (counter) {
      counter.n++;
      counter.body = new URLSearchParams(await request.text());
      counter.auth = request.headers.get('authorization');
    }
    return HttpResponse.json({ access_token: 'tok-1', expires_in: 3600, token_type: 'Bearer' });
  });

const money = (amount: number) => ({ amount, currency: 'PLN' });

/** A paid order delivered to a parcel locker, with a company invoice; two units of one offer. */
const paidOrder = {
  id: 'a1b2c3d4-0000-4000-8000-000000000001',
  organizationId: ORG,
  createdAt: '2026-10-05T08:00:00Z',
  updatedAt: '2026-10-05T08:05:00Z',
  status: 'ACCEPTED',
  customer: {
    email: 'anna@example.com',
    firstName: 'Anna',
    lastName: 'Nowak',
    phoneNumber: '+48600100200',
    address: { street: 'Prosta', building: '12', flat: '4', city: 'Warszawa', postCode: '00001', countryCode: 'PL' },
  },
  invoice: {
    email: 'faktury@firma.pl',
    legalForm: 'COMPANY',
    companyName: 'Kosmetyki Sp. z o.o.',
    taxIdPrefix: 'PL',
    taxId: '5250001009',
    address: { street: 'Długa', building: '1', city: 'Kraków', postCode: '30001', countryCode: 'PL' },
  },
  delivery: {
    deliveryType: 'APM',
    parcels: [],
    name: 'InPost Paczkomat',
    deliveryPoint: 'KRA010',
    address: { street: 'Floriańska', building: '5', city: 'Kraków', postCode: '31019', countryCode: 'PL' },
    price: money(9.99),
  },
  orderLines: [
    { offer: { offerId: 'offer-1', product: { productId: 'p1', name: 'Anua Toner 250 ml', ean: '8809640735455', sku: 'LUA024' }, price: money(59.9), finalPrice: money(59.9), basePrice: money(59.9) } },
    { offer: { offerId: 'offer-1', product: { productId: 'p1', name: 'Anua Toner 250 ml', ean: '8809640735455', sku: 'LUA024' }, price: money(59.9), finalPrice: money(59.9), basePrice: money(59.9) } },
  ],
  finalPrice: money(129.79),
  basePrice: money(129.79),
  paymentDetails: { selectedPaymentType: 'BLIK_CODE', payments: [{ paymentId: 'pay-1', paymentType: 'BLIK_CODE', paymentDate: '2026-10-05T08:01:00Z' }] },
};

const unpaid = { ...paidOrder, id: 'a1b2c3d4-0000-4000-8000-000000000002', status: 'CREATED', customer: undefined, paymentDetails: { selectedPaymentType: 'UNKNOWN', payments: [] } };
const refusedPaid = { ...paidOrder, id: 'a1b2c3d4-0000-4000-8000-000000000003', status: 'CANCELED', updatedAt: '2026-10-05T09:00:00Z' };
const rejectedUnpaid = { ...unpaid, id: 'a1b2c3d4-0000-4000-8000-000000000004', status: 'REJECTED' };

describe('mapVonHalskyOrder', () => {
  it('maps a paid locker order: grouped lines, locker code, e-mail for the label, company invoice', () => {
    const o = mapVonHalskyOrder(paidOrder);
    expect(o).toMatchObject({
      externalId: 'a1b2c3d4-0000-4000-8000-000000000001',
      externalNumber: 'A1B2C3D4',
      marketplaceStatus: 'ACCEPTED / PAID',
      readyToShip: true,
      cancelled: false,
      fulfilled: false,
      pickupPointId: 'KRA010',
      deliveryMethodId: 'APM',
      totalAmount: '129.79',
      shippingAmount: '9.99',
      currency: 'PLN',
      codAmount: null,
    });
    expect(o.buyer).toEqual({ name: 'Anna Nowak', email: 'anna@example.com', phone: '+48600100200' });
    expect(o.shippingAddress).toMatchObject({ name: 'Anna Nowak', street: 'Floriańska 5', city: 'Kraków', postalCode: '31-019', countryCode: 'PL', email: 'anna@example.com' });
    expect(o.items).toEqual([
      { externalLineId: 'offer-1', sku: 'LUA024', name: 'Anua Toner 250 ml', quantity: 2, unitPrice: '59.90', externalProductId: 'offer-1', discountAmount: null },
    ]);
    expect(o.invoiceRequest).toEqual({
      name: 'Kosmetyki Sp. z o.o.',
      taxId: '5250001009',
      euPrefix: 'PL',
      street: 'Długa 1',
      postalCode: '30-001',
      city: 'Kraków',
      countryCode: 'PL',
      email: 'faktury@firma.pl',
    });
    expect(o.placedAt).toEqual(new Date('2026-10-05T08:00:00Z'));
    expect(o.paidAt).toEqual(new Date('2026-10-05T08:01:00Z'));
  });

  it('records the promotion discount as base price minus final price, per line', () => {
    const line = (final: number) => ({
      offer: { offerId: 'offer-1', product: { productId: 'p1', name: 'Anua Toner 250 ml', sku: 'LUA024' }, finalPrice: money(final), basePrice: money(59.9) },
    });
    const o = mapVonHalskyOrder({ ...paidOrder, orderLines: [line(49.9), line(49.9)] });
    expect(o.items[0]).toMatchObject({ quantity: 2, unitPrice: '49.90', discountAmount: '20.00' });
  });

  it('knows cash on delivery, shipped parcels and cancelled orders', () => {
    const cod = mapVonHalskyOrder({ ...paidOrder, paymentDetails: { selectedPaymentType: 'CASH_ON_DELIVERY', payments: [] } });
    expect(cod).toMatchObject({ readyToShip: true, codAmount: '129.79', marketplaceStatus: 'ACCEPTED / COD' });
    const sent = mapVonHalskyOrder({ ...paidOrder, delivery: { ...paidOrder.delivery, parcels: [{ trackingNumber: '6200', createdAt: '2026-10-05T10:00:00Z', status: 'SENT' }] } });
    expect(sent.fulfilled).toBe(true);
    expect(mapVonHalskyOrder(refusedPaid)).toMatchObject({ cancelled: true, readyToShip: false });
    expect(mapVonHalskyOrder(paidOrder).invoiceRequest?.taxId).toBe('5250001009');
    expect(mapVonHalskyOrder({ ...paidOrder, invoice: undefined }).invoiceRequest).toBeNull();
  });

  it('imports accepted orders and paid cancellations, never unpaid ones', () => {
    const parse = (o: unknown) => vonHalskyOrderSchema.parse(o);
    expect(isImportable(parse(paidOrder))).toBe(true);
    expect(isImportable(parse(refusedPaid))).toBe(true);
    expect(isImportable(parse(unpaid))).toBe(false);
    expect(isImportable(parse(rejectedUnpaid))).toBe(false);
  });
});

describe('VonHalskyAdapter', () => {
  it('signs in with the client credentials once, caches the token and refreshes it after a 401', async () => {
    const token = { n: 0 } as { n: number; body?: URLSearchParams; auth?: string | null };
    let calls = 0;
    server.use(
      tokenHandler(token),
      http.get(`${API}/offers`, ({ request }) => {
        calls++;
        if (calls === 2) return HttpResponse.json({ errorCode: 'UNAUTHORIZED', errorMessage: 'Token expired' }, { status: 401 });
        expect(request.headers.get('authorization')).toBe('Bearer tok-1');
        return HttpResponse.json({ page: { limit: 1, offset: 0, total: 3 }, data: [] });
      }),
    );
    const s = store();
    const adapter = new VonHalskyAdapter(s);
    expect(await adapter.checkConnection()).toContain('3 offer(s)');
    expect(token.n).toBe(1);
    expect(token.body?.get('grant_type')).toBe('client_credentials');
    expect(token.body?.get('scope')).toBe('openid api:categories:read api:offers:read api:offers:write api:orders:read api:orders:write');
    expect(token.auth).toBe(`Basic ${Buffer.from('cid:secret').toString('base64')}`);
    expect(s.saved[0].accessToken).toBe('tok-1');
    await adapter.checkConnection(); // cached token, but the API answers 401 → one new token
    expect(token.n).toBe(2);
  });

  it('turns InPost error answers into readable messages', async () => {
    server.use(
      tokenHandler(),
      http.get(`${API}/offers`, () =>
        HttpResponse.json({ errorCode: 'FORBIDDEN', errorMessage: 'Missing scope', details: [{ field: 'scope', detail: 'api:offers:read' }] }, { status: 403 }),
      ),
    );
    const err = await new VonHalskyAdapter(store()).checkConnection().catch((e) => e);
    expect(err).toBeInstanceOf(VonHalskyApiError);
    expect(err.message).toBe('InPost Von Halsky (HTTP 403 FORBIDDEN): Missing scope (scope: api:offers:read)');
  });

  it('reads the order list since the cursor, pages through it and keeps only importable orders', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      tokenHandler(),
      http.get(`${API}/orders`, ({ request }) => {
        const q = new URL(request.url).searchParams;
        seen.push(q);
        const offset = Number(q.get('offset'));
        const all = [paidOrder, unpaid, refusedPaid, rejectedUnpaid];
        // Two pages: the test pretends the API applies a page size of 2.
        const data = all.slice(offset, offset + 2);
        return HttpResponse.json({ page: { limit: 2, offset, total: all.length }, data });
      }),
    );
    const adapter = new VonHalskyAdapter(store());
    const result = await adapter.syncOrders('2026-10-05T07:00:00Z');
    expect(seen.map((q) => [q.get('updatedAtGte'), q.get('sort'), q.get('offset')])).toEqual([
      ['2026-10-05T07:00:00Z', 'updatedAt', '0'],
      ['2026-10-05T07:00:00Z', 'updatedAt', '2'],
    ]);
    expect(result.orders.map((o) => o.externalId)).toEqual([paidOrder.id, refusedPaid.id]);
    expect(result.nextCursor).toBe('2026-10-05T09:00:00Z');
    expect(result.hasMore).toBe(false);
  });

  it('starts from the last N days on the first sync and keeps the start as the cursor when nothing came', async () => {
    let since = '';
    server.use(
      tokenHandler(),
      http.get(`${API}/orders`, ({ request }) => {
        since = new URL(request.url).searchParams.get('updatedAtGte') ?? '';
        return HttpResponse.json({ page: { limit: 30, offset: 0, total: 0 }, data: [] });
      }),
    );
    const result = await new VonHalskyAdapter(store(), { initialSyncDays: 3 }).syncOrders(null);
    expect(Date.now() - new Date(since).getTime()).toBeGreaterThan(3 * 86_400_000 - 60_000);
    expect(result).toEqual({ orders: [], nextCursor: since, hasMore: false });
  });

  it('lists offers with their EAN and stock', async () => {
    server.use(
      tokenHandler(),
      http.get(`${API}/offers`, ({ request }) => {
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        const data = [
          { id: 'offer-1', status: 'PUBLISHED', product: { name: 'Anua Toner', sku: 'LUA024', ean: '8809640735455' }, stock: { quantity: 7, unit: 'UNIT' } },
          { id: 'offer-2', status: 'SOLDOUT', product: { name: 'Cream' }, stock: { quantity: 0, unit: 'UNIT' } },
        ];
        return HttpResponse.json({ page: { limit: 30, offset, total: 2 }, data: offset === 0 ? data : [] });
      }),
    );
    const listings = [];
    for await (const l of new VonHalskyAdapter(store()).listListings()) listings.push(l);
    expect(listings).toEqual([
      { externalId: 'offer-1', sku: 'LUA024', title: 'Anua Toner', quantity: 7, active: true, status: 'PUBLISHED', ean: '8809640735455', ref: { offerId: 'offer-1', status: 'PUBLISHED', externalId: null, price: null } },
      { externalId: 'offer-2', sku: null, title: 'Cream', quantity: 0, active: true, status: 'SOLDOUT', ean: null, ref: { offerId: 'offer-2', status: 'SOLDOUT', externalId: null, price: null } },
    ]);
  });

  it('sets stock in a batch and waits for the commands', async () => {
    let body: unknown;
    let polls = 0;
    server.use(
      tokenHandler(),
      http.patch(`${API}/offers/stocks`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([
          { commandId: 'c1', offerId: 'offer-1', status: 'PENDING' },
          { commandId: 'c2', offerId: 'offer-2', status: 'SUCCESS' },
        ]);
      }),
      http.get(`${API}/offers/commands/c1`, () => {
        polls++;
        return HttpResponse.json({ commandId: 'c1', status: polls < 2 ? 'PENDING' : 'SUCCESS' });
      }),
    );
    await new VonHalskyAdapter(store()).setStock([
      { externalId: 'offer-1', sku: null, ref: {}, quantity: 5 },
      { externalId: 'offer-2', sku: null, ref: {}, quantity: -3 },
    ]);
    expect(body).toEqual([
      { offerId: 'offer-1', stock: { quantity: 5, unit: 'UNIT' } },
      { offerId: 'offer-2', stock: { quantity: 0, unit: 'UNIT' } },
    ]);
    expect(polls).toBe(2);
  });

  it('falls back to one request per offer when the batch endpoint does not exist, and reports a refused command', async () => {
    const patched: { id: string; type: string | null; body: unknown }[] = [];
    server.use(
      tokenHandler(),
      http.patch(`${API}/offers/stocks`, () => HttpResponse.json({ errorCode: 'RESOURCE_NOT_FOUND', errorMessage: 'Not implemented' }, { status: 404 })),
      http.patch(`${API}/offers/:offerId`, async ({ request, params }) => {
        patched.push({ id: String(params.offerId), type: request.headers.get('content-type'), body: await request.json() });
        return HttpResponse.json({ id: params.offerId });
      }),
    );
    await new VonHalskyAdapter(store()).setStock([{ externalId: 'offer-9', sku: null, ref: {}, quantity: 2 }]);
    expect(patched).toEqual([{ id: 'offer-9', type: 'application/merge-patch+json', body: { stock: { quantity: 2, unit: 'UNIT' } } }]);

    server.use(
      http.patch(`${API}/offers/stocks`, () => HttpResponse.json([{ commandId: 'c9', offerId: 'offer-3', status: 'PENDING' }])),
      http.get(`${API}/offers/commands/c9`, () => HttpResponse.json({ commandId: 'c9', status: 'FAILURE', errors: [{ message: 'Offer is closed' }] })),
    );
    await expect(new VonHalskyAdapter(store()).setStock([{ externalId: 'offer-3', sku: null, ref: {}, quantity: 1 }])).rejects.toThrow(
      'InPost Von Halsky refused the stock update (offer offer-3: Offer is closed)',
    );
  });
});

describe('Authorization Code sign-in', () => {
  it('builds a PKCE authorize URL for the right environment', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).not.toBe(verifier);
    const url = new URL(vonHalskyAuthorizeUrl({ clientId: 'cid', sandbox: true }, 'https://app.example/api/oauth/vonhalsky/callback', 'st', challenge));
    expect(url.origin + url.pathname).toBe('https://stage-account.inpost-group.com/oauth2/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('cid');
    expect(url.searchParams.get('redirect_uri')).toBe('https://app.example/api/oauth/vonhalsky/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('code_challenge')).toBe(challenge);
    expect(url.searchParams.get('scope')).toContain('api:orders:read');
  });

  it('exchanges the code with the PKCE verifier and keeps the refresh token', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        seen.push(new URLSearchParams(await request.text()));
        return HttpResponse.json({ access_token: 'a1', refresh_token: 'r1', expires_in: 300 });
      }),
    );
    const next = await exchangeVonHalskyCode({ organizationId: ORG, clientId: 'cid', clientSecret: '', sandbox: true }, 'the-code', 'https://app.example/cb', 'ver');
    expect(seen[0].get('grant_type')).toBe('authorization_code');
    expect(seen[0].get('code')).toBe('the-code');
    expect(seen[0].get('code_verifier')).toBe('ver');
    expect(seen[0].get('redirect_uri')).toBe('https://app.example/cb');
    expect(next.accessToken).toBe('a1');
    expect(next.refreshToken).toBe('r1');
  });

  it('refreshes with the rotating refresh token and saves the new one', async () => {
    const seen: URLSearchParams[] = [];
    server.use(
      http.post(TOKEN_URL, async ({ request }) => {
        seen.push(new URLSearchParams(await request.text()));
        return HttpResponse.json({ access_token: 'a2', refresh_token: 'r2', expires_in: 300 });
      }),
      http.get(`${API}/offers`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('Bearer a2');
        return HttpResponse.json({ items: [] });
      }),
    );
    const creds = store({ refreshToken: 'r1', accessToken: 'old', expiresAt: new Date(Date.now() - 1000).toISOString() });
    const client = new VonHalskyClient(creds);
    await client.call('GET', client.org('/offers'));
    expect(seen[0].get('grant_type')).toBe('refresh_token');
    expect(seen[0].get('refresh_token')).toBe('r1');
    expect(creds.get().refreshToken).toBe('r2');
  });
});

describe('offers created from Shopify', () => {
  const input = {
    externalId: 'luora:p1',
    name: 'Serum',
    descriptionHtml: '<p>x</p>',
    brand: 'VT',
    categoryId: 'cat-1',
    sku: 'SKU1',
    ean: '8803463017859',
    dimension: { width: 10, height: 10, length: 5, weight: 300 },
    quantity: 4,
    price: '98.99',
    currency: 'PLN',
    daysToShip: 1,
    imageUrls: ['https://img/1.jpg', 'https://img/2.jpg'],
  };

  it('derives unique image file names from CDN URLs', () => {
    expect(
      imageFileNames(['https://cdn.shopify.com/s/files/abc_def.jpg?v=123', 'https://other/abc_def.jpg', 'https://x/photo']).map((i) => i.fileName),
    ).toEqual(['abc_def.jpg', 'abc_def-2.jpg', 'photo.jpg']);
  });

  it('computes prices from Shopify + markup with the chosen rounding', () => {
    expect(offerPrice('89.90', { vhMarkupPercent: 10 })).toBe('98.99');
    expect(offerPrice('89.90', { vhMarkupPercent: 10, vhRounding: 'x.00' })).toBe('99.00');
    expect(offerPrice('89.90', { vhMarkupPercent: 10, vhRounding: 'none' })).toBe('98.89');
    expect(offerPrice('100', {})).toBe('109.99');
  });

  it('suggests a face-cream category from the product type and title', () => {
    const cats = [
      { id: 'a', path: 'Uroda › Pielęgnacja › Pielęgnacja twarzy › Kremy do twarzy' },
      { id: 'b', path: 'Uroda › Pielęgnacja › Pielęgnacja włosów › Szampony' },
      { id: 'c', path: 'Uroda › Makijaż › Usta › Pomadki' },
    ];
    expect(suggestCategory('Face cream', 'VT Vitamin C krem 50ml', cats)?.id).toBe('a');
    expect(suggestCategory('', 'Zupełnie inne', cats)).toBeNull();
  });

  it('posts the offer, waits for the command and reports validation errors', async () => {
    let posted: Record<string, unknown> | null = null;
    server.use(
      tokenHandler(),
      http.post(`${API}/offers`, async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ commandId: 'c1', status: 'PENDING' });
      }),
      http.get(`${API}/offers/commands/c1`, () => HttpResponse.json({ commandId: 'c1', status: 'SUCCESS' })),
      http.get(`${API}/offers`, () =>
        HttpResponse.json({
          page: { limit: 30, offset: 0, total: 2 },
          data: [
            { metadata: { validationErrors: ['other offer problem'] }, offer: { id: 'o0', product: { name: 'Other', ean: '111' } } },
            { metadata: { validationErrors: [] }, offer: { id: 'o1', product: { name: 'Serum', ean: input.ean } } },
          ],
        }),
      ),
    );
    await new VonHalskyAdapter(store()).createOffer(input);
    expect(posted).toMatchObject({
      externalId: 'luora:p1',
      product: { name: 'Serum', brand: 'VT', categoryId: 'cat-1', ean: input.ean, dimension: input.dimension },
      stock: { quantity: 4, unit: 'UNIT' },
      price: { grossPrice: { amount: 98.99, currency: 'PLN' }, taxRateInfo: '23.00' },
      shippingTime: { daysToShip: 1 },
      images: [
        { fileName: '1.jpg', fileUrl: 'https://img/1.jpg', priority: 1 },
        { fileName: '2.jpg', fileUrl: 'https://img/2.jpg', priority: 2 },
      ],
    });

    server.use(
      http.get(`${API}/offers`, () =>
        HttpResponse.json({
          page: { limit: 30, offset: 0, total: 1 },
          data: [{ metadata: { validationErrors: ['images: too small'] }, offer: { id: 'o1', product: { name: 'Serum', ean: input.ean } } }],
        }),
      ),
    );
    await expect(new VonHalskyAdapter(store()).createOffer(input)).rejects.toThrow('images: too small');
  });

  it('lists offers from the wrapped { metadata, offer } shape with price and external id', async () => {
    server.use(
      tokenHandler(),
      http.get(`${API}/offers`, () =>
        HttpResponse.json({
          page: { limit: 30, offset: 0, total: 1 },
          data: [
            {
              metadata: { validationErrors: [] },
              offer: {
                id: 'o1',
                status: 'PUBLISHED',
                externalId: 'luora:p1',
                product: { name: 'Serum', ean: input.ean, sku: 'S1' },
                stock: { quantity: 3 },
                price: { grossPrice: { amount: 98.99 } },
              },
            },
          ],
        }),
      ),
    );
    const out = [];
    for await (const l of new VonHalskyAdapter(store()).listListings()) out.push(l);
    expect(out).toEqual([
      { externalId: 'o1', sku: 'S1', title: 'Serum', quantity: 3, active: true, status: 'PUBLISHED', ean: input.ean, ref: { offerId: 'o1', status: 'PUBLISHED', externalId: 'luora:p1', price: 98.99 } },
    ]);
  });

  it('updates prices in a batch and reads the category tree level by level', async () => {
    let body: unknown;
    server.use(
      tokenHandler(),
      http.patch(`${API}/offers/prices`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json([]);
      }),
      http.get('https://stage-api.inpost-group.com/inpsa/v1/categories', () =>
        HttpResponse.json([{ id: 'r', name: 'Uroda', leaf: false, children: [{ id: 'g', name: 'Pielęgnacja', leaf: false }, { id: 'l', name: 'Perfumy', leaf: true }] }]),
      ),
      http.get('https://stage-api.inpost-group.com/inpsa/v1/categories/g', () =>
        HttpResponse.json({ id: 'g', name: 'Pielęgnacja', leaf: false, children: [{ id: 'k', name: 'Kremy', leaf: true }] }),
      ),
    );
    const adapter = new VonHalskyAdapter(store());
    await adapter.updatePrices([{ offerId: 'o1', price: '98.99', currency: 'PLN' }]);
    expect(body).toEqual([{ offerId: 'o1', price: { grossPrice: { amount: 98.99, currency: 'PLN' } } }]);
    expect(await adapter.categoryLeaves('uroda')).toEqual([
      { id: 'l', path: 'Uroda › Perfumy' },
      { id: 'k', path: 'Uroda › Pielęgnacja › Kremy' },
    ]);
  });
});
