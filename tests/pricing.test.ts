import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { formatPrice, parsePrice, priceChangePercent, samePrice } from '@/lib/price';
import { AllegroAdapter } from '@/server/integrations/marketplaces/allegro/adapter';
import type { AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { EmpikAdapter } from '@/server/integrations/marketplaces/empik/adapter';
import { buildPriceCsv } from '@/server/integrations/marketplaces/mirakl/adapter';
import { ShopifyAdapter } from '@/server/integrations/marketplaces/shopify/adapter';
import type { ShopifyCredentials } from '@/server/integrations/marketplaces/shopify/client';
import { VonHalskyAdapter } from '@/server/integrations/marketplaces/vonhalsky/adapter';
import type { VonHalskyCredentials } from '@/server/integrations/marketplaces/vonhalsky/client';
import type { PriceUpdate } from '@/server/integrations/types';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const update = (over: Partial<PriceUpdate> = {}): PriceUpdate => ({ externalId: 'x1', sku: 'SKU-1', ean: null, ref: {}, price: '49.99', currency: 'PLN', ...over });

describe('typing a price', () => {
  it('accepts a Polish comma, whole numbers and one decimal, and always returns two decimals', () => {
    expect(parsePrice('49,99')).toBe('49.99');
    expect(parsePrice('49.9')).toBe('49.90');
    expect(parsePrice(' 50 ')).toBe('50.00');
    expect(parsePrice('1 299,00 zł')).toBe('1299.00');
    expect(parsePrice(12.5)).toBe('12.50');
  });

  it('refuses anything that is not a price above zero', () => {
    for (const bad of ['', '0', '0,00', '-5', 'abc', '12,345', '1,2,3', '100000', null, undefined]) expect(parsePrice(bad)).toBeNull();
  });

  it('compares prices by value, and never calls a missing price the same', () => {
    expect(samePrice('49.9', '49.90')).toBe(true);
    expect(samePrice('49.99', 49.99)).toBe(true);
    expect(samePrice('49.99', '50.00')).toBe(false);
    expect(samePrice(null, '49.99')).toBe(false);
    expect(samePrice('', '')).toBe(false);
  });

  it('gives the change in percent', () => {
    expect(priceChangePercent('100.00', '110.00')).toBeCloseTo(10);
    expect(priceChangePercent('100.00', '80.00')).toBeCloseTo(-20);
    expect(priceChangePercent(null, '80.00')).toBeNull();
    expect(priceChangePercent('0', '80.00')).toBeNull();
  });

  it('shows złoty as zł and other currencies by code', () => {
    expect(formatPrice('1299')).toMatch(/^1\s?299,00 zł$/);
    expect(formatPrice('9.5', 'EUR')).toBe('9,50 EUR');
    expect(formatPrice(null)).toBe('—');
  });
});

describe('Shopify prices', () => {
  const SHOP = 'https://luora.myshopify.com';
  const store = (): { get: () => ShopifyCredentials; save: () => Promise<void> } => ({ get: () => ({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' }), save: async () => {} });
  const graphql = `${SHOP}/admin/api/2026-07/graphql.json`;

  it('reads the price and the product of every variant', async () => {
    server.use(
      http.post(graphql, () =>
        HttpResponse.json({
          data: {
            productVariants: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes: [{ id: 'gid://shopify/ProductVariant/1', sku: 'A', barcode: null, price: '59.9', displayName: 'Cream', inventoryQuantity: 3, inventoryItem: { id: 'i1' }, image: null, product: { id: 'gid://shopify/Product/9', vendor: 'V', productType: 'T', featuredImage: null } }],
            },
          },
        }),
      ),
    );
    const out = [];
    for await (const l of new ShopifyAdapter(store()).listListings()) out.push(l);
    expect(out[0]).toMatchObject({ price: '59.90', ref: { inventoryItemId: 'i1', productId: 'gid://shopify/Product/9' } });
  });

  it('changes variants one product at a time, asking Shopify for the product of listings imported before it was kept', async () => {
    const mutations: { productId: string; variants: unknown[] }[] = [];
    server.use(
      http.post(graphql, async ({ request }) => {
        const { query, variables } = (await request.json()) as { query: string; variables: Record<string, unknown> };
        if (query.includes('VariantProducts')) {
          expect(variables.ids).toEqual(['gid://shopify/ProductVariant/3']);
          return HttpResponse.json({ data: { nodes: [{ id: 'gid://shopify/ProductVariant/3', product: { id: 'gid://shopify/Product/8' } }] } });
        }
        mutations.push(variables as { productId: string; variants: unknown[] });
        return HttpResponse.json({ data: { productVariantsBulkUpdate: { userErrors: variables.productId === 'gid://shopify/Product/7' ? [{ field: ['price'], message: 'Price must be positive' }] : [] } } });
      }),
    );
    const failures = await new ShopifyAdapter(store()).setPrices([
      update({ externalId: 'gid://shopify/ProductVariant/1', ref: { productId: 'gid://shopify/Product/9' }, price: '10.00' }),
      update({ externalId: 'gid://shopify/ProductVariant/2', ref: { productId: 'gid://shopify/Product/9' }, price: '20.00' }),
      update({ externalId: 'gid://shopify/ProductVariant/3', ref: {}, price: '30.00' }),
      update({ externalId: 'gid://shopify/ProductVariant/4', ref: { productId: 'gid://shopify/Product/7' }, price: '40.00' }),
    ]);
    expect(mutations).toEqual([
      { productId: 'gid://shopify/Product/9', variants: [{ id: 'gid://shopify/ProductVariant/1', price: '10.00' }, { id: 'gid://shopify/ProductVariant/2', price: '20.00' }] },
      { productId: 'gid://shopify/Product/8', variants: [{ id: 'gid://shopify/ProductVariant/3', price: '30.00' }] },
      { productId: 'gid://shopify/Product/7', variants: [{ id: 'gid://shopify/ProductVariant/4', price: '40.00' }] },
    ]);
    expect(failures).toEqual([{ externalId: 'gid://shopify/ProductVariant/4', message: 'Shopify: Price must be positive' }]);
  });

  it('reports a variant that no longer exists instead of sending it', async () => {
    server.use(http.post(graphql, () => HttpResponse.json({ data: { nodes: [null] } })));
    const failures = await new ShopifyAdapter(store()).setPrices([update({ externalId: 'gid://shopify/ProductVariant/5', ref: {} })]);
    expect(failures).toEqual([{ externalId: 'gid://shopify/ProductVariant/5', message: 'Shopify has no such variant any more' }]);
  });
});

describe('Allegro prices', () => {
  const API = 'https://api.allegro.pl.allegrosandbox.pl';
  const store = () => {
    let current: AllegroCredentials = { clientId: 'c', clientSecret: 's', sandbox: true, accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    return { get: () => current, save: async (n: AllegroCredentials) => void (current = n) };
  };

  it('reads the price and currency of every offer', async () => {
    server.use(
      http.get(`${API}/sale/offers`, () =>
        HttpResponse.json({ totalCount: 2, offers: [{ id: '1', name: 'With price', sellingMode: { price: { amount: '79', currency: 'PLN' } } }, { id: '2', name: 'Without' }] }),
      ),
    );
    const out = [];
    for await (const l of new AllegroAdapter(store()).listListings()) out.push(l);
    expect(out.map((l) => [l.externalId, l.price, l.currency])).toEqual([
      ['1', '79.00', 'PLN'],
      ['2', null, null],
    ]);
  });

  it('patches the selling price of each offer, and an offer Allegro refuses fails alone', async () => {
    const bodies: Record<string, unknown> = {};
    server.use(
      http.patch(`${API}/sale/product-offers/:id`, async ({ request, params }) => {
        bodies[String(params.id)] = await request.json();
        if (params.id === 'bad') return HttpResponse.json({ errors: [{ code: 'X', userMessage: 'The price is too low for this category' }] }, { status: 422 });
        return new HttpResponse(null, { status: 200 });
      }),
    );
    const failures = await new AllegroAdapter(store()).setPrices([update({ externalId: 'ok', price: '12.50' }), update({ externalId: 'bad', price: '0.10' }), update({ externalId: 'ok2', price: '99.00' })]);
    expect(bodies.ok).toEqual({ sellingMode: { price: { amount: '12.50', currency: 'PLN' } } });
    expect(Object.keys(bodies)).toEqual(['ok', 'bad', 'ok2']); // the refusal did not stop the rest
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ externalId: 'bad' });
    expect(failures[0].message).toContain('too low');
  });
});

describe('Empik prices', () => {
  const BASE = 'https://marketplace.empik.test';
  const creds = { baseUrl: BASE, apiKey: 'key-123' };

  it('reads the price of every offer', async () => {
    server.use(
      http.get(`${BASE}/api/offers`, () =>
        HttpResponse.json({ total_count: 1, offers: [{ offer_id: 5551, shop_sku: 'LUO-NTB-A5', product_title: 'Notes', quantity: 4, price: 29.9, currency_iso_code: 'PLN', active: true }] }),
      ),
    );
    const out = [];
    for await (const l of new EmpikAdapter(creds).listListings()) out.push(l);
    expect(out[0]).toMatchObject({ externalId: '5551', price: '29.90', currency: 'PLN' });
  });

  it('builds a CSV with only the SKU and the price, so nothing else on the offer changes', () => {
    expect(buildPriceCsv([update({ sku: 'A;B"C', ref: {} }), update({ sku: 'LUO-1', ref: { shopSku: 'LUO-1' }, price: '5.00' }), update({ sku: null, ref: {} })])).toBe(
      '"sku";"price";"update-delete"\n"A;B""C";"49.99";"update"\n"LUO-1";"5.00";"update"\n',
    );
  });

  it('uploads the CSV as a NORMAL import (the only mode besides REPLACE) and waits for its verdict', async () => {
    let csv = '';
    let mode: FormDataEntryValue | null = null;
    server.use(
      http.post(`${BASE}/api/offers/imports`, async ({ request }) => {
        const form = await request.formData();
        csv = await (form.get('file') as File).text();
        mode = form.get('import_mode');
        return HttpResponse.json({ import_id: 9 });
      }),
      http.get(`${BASE}/api/offers/imports/9`, () => HttpResponse.json({ status: 'COMPLETE', lines_in_error: 0 })),
    );
    const failures = await new EmpikAdapter(creds).setPrices([update({ ref: { shopSku: 'LUO-1' }, price: '5.00' })]);
    expect(failures).toEqual([]);
    expect(mode).toBe('NORMAL');
    expect(csv).toContain('"LUO-1";"5.00";"update"');
  });

  it('reports Empik’s reason on every offer of a refused import, and an offer without a SKU on its own', async () => {
    server.use(
      http.post(`${BASE}/api/offers/imports`, () => HttpResponse.json({ import_id: 10 })),
      http.get(`${BASE}/api/offers/imports/10`, () => HttpResponse.json({ status: 'COMPLETE', lines_in_error: 1, has_error_report: true })),
      http.get(`${BASE}/api/offers/imports/10/error_report`, () => new HttpResponse('sku;price;error\nLUO-1;5.00;price below minimum\n')),
    );
    const failures = await new EmpikAdapter(creds).setPrices([update({ externalId: 'a', ref: { shopSku: 'LUO-1' } }), update({ externalId: 'b', sku: null, ref: {} })]);
    expect(failures.map((f) => f.externalId).sort()).toEqual(['a', 'b']);
    expect(failures.find((f) => f.externalId === 'a')?.message).toContain('price below minimum');
    expect(failures.find((f) => f.externalId === 'b')?.message).toContain('no SKU');
  });
});

describe('Von Halsky prices', () => {
  const ORG = '5b0e6b0a-6f5c-4a43-9a53-0d2f9d7a1111';
  const API = `https://stage-api.inpost-group.com/inpsa/v1/organizations/${ORG}`;
  const store = () => {
    let current: VonHalskyCredentials = { organizationId: ORG, clientId: 'c', clientSecret: 's', sandbox: true };
    return { get: () => current, save: async (n: VonHalskyCredentials) => void (current = n) };
  };
  const token = http.post('https://stage-account.inpost-group.com/oauth2/token', () => HttpResponse.json({ access_token: 't', expires_in: 3600, token_type: 'Bearer' }));

  it('reads the price and currency of every offer', async () => {
    server.use(
      token,
      http.get(`${API}/offers`, () => HttpResponse.json({ page: { limit: 30, offset: 0, total: 1 }, data: [{ id: 'o1', status: 'PUBLISHED', product: { name: 'Serum', sku: 'S1' }, price: { grossPrice: { amount: 98.9, currency: 'PLN' } } }] })),
    );
    const out = [];
    for await (const l of new VonHalskyAdapter(store()).listListings()) out.push(l);
    expect(out[0]).toMatchObject({ price: '98.90', currency: 'PLN' });
  });

  it('sends the batch and passes InPost’s refusal to every offer in it', async () => {
    let body: unknown;
    let refuse = false;
    server.use(
      token,
      http.patch(`${API}/offers/prices`, async ({ request }) => {
        body = await request.json();
        return refuse ? HttpResponse.json({ message: 'Price is below the allowed minimum' }, { status: 400 }) : HttpResponse.json([]);
      }),
    );
    const adapter = new VonHalskyAdapter(store());
    expect(await adapter.setPrices([update({ externalId: 'o1', price: '98.99' })])).toEqual([]);
    expect(body).toEqual([{ offerId: 'o1', price: { grossPrice: { amount: 98.99, currency: 'PLN' } } }]);
    refuse = true;
    const failures = await adapter.setPrices([update({ externalId: 'o1' }), update({ externalId: 'o2' })]);
    expect(failures.map((f) => f.externalId)).toEqual(['o1', 'o2']);
    expect(failures[0].message.length).toBeGreaterThan(0);
  });
});
