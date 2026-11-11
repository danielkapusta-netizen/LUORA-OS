import { createHmac } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import order from './fixtures/shopify/order.json';
import { ShopifyAdapter } from '@/server/integrations/marketplaces/shopify/adapter';
import type { ShopifyCredentials } from '@/server/integrations/marketplaces/shopify/client';
import { mapShopifyOrder } from '@/server/integrations/marketplaces/shopify/mapper';
import { validShopifyHmac } from '@/server/integrations/marketplaces/shopify/webhook';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const SHOP = 'https://luora.myshopify.com';

function store(initial: ShopifyCredentials) {
  let current = initial;
  const saved: ShopifyCredentials[] = [];
  return { saved, get: () => current, save: async (next: ShopifyCredentials) => void saved.push((current = next)) };
}

describe('mapShopifyOrder', () => {
  it('normalises an order and finds the locker in note attributes', () => {
    const o = mapShopifyOrder(order);
    expect(o).toMatchObject({
      externalId: 'gid://shopify/Order/5612345678901',
      externalNumber: '#1042',
      readyToShip: true,
      cancelled: false,
      pickupPointId: 'KRA010',
      codAmount: null,
      totalAmount: '171.98',
      shippingAmount: '12.99',
      currency: 'PLN',
    });
    expect(o.shippingAddress).toMatchObject({ street: 'ul. Długa 5/3', postalCode: '31-147', city: 'Kraków' });
    expect(o.items).toHaveLength(2);
    expect(o.items[1].sku).toBeNull();
  });

  it('reads the locker code when a pickup-point plugin saves the address first', () => {
    const attrs = (customAttributes: { key: string; value: string }[]) => mapShopifyOrder({ ...order, customAttributes }).pickupPointId;
    expect(attrs([
      { key: 'pickup_point_address', value: 'Aleja Jordana 16, 95-083 Lutomiersk' },
      { key: 'pickup_point_id', value: 'LUT02M' },
    ])).toBe('LUT02M');
    expect(attrs([{ key: 'inpost_point', value: 'PL_LUT02M' }])).toBe('LUT02M');
    expect(attrs([{ key: 'pickup_point', value: 'Aleja Jordana 16, 95-083 Lutomiersk' }])).toBeNull();
    // No pickup attribute: the code is read from the shipping line, app-only lockers included.
    const fromTitle = mapShopifyOrder({ ...order, customAttributes: [], shippingLine: { ...order.shippingLine, title: 'Inpost Paczkomat · KRA03BAPP' } });
    expect(fromTitle.pickupPointId).toBe('KRA03BAPP');
  });

  it('treats cash on delivery as ready even when unpaid', () => {
    const o = mapShopifyOrder({ ...order, displayFinancialStatus: 'PENDING', paymentGatewayNames: ['Cash on Delivery (COD)'] });
    expect(o.readyToShip).toBe(true);
    expect(o.codAmount).toBe('171.98');
  });
});

describe('ShopifyAdapter', () => {
  it('gets a client-credentials token, caches it, and pages through orders', async () => {
    let tokenCalls = 0;
    const queries: string[] = [];
    server.use(
      http.post(`${SHOP}/admin/oauth/access_token`, async ({ request }) => {
        tokenCalls++;
        const body = new URLSearchParams(await request.text());
        expect(body.get('grant_type')).toBe('client_credentials');
        return HttpResponse.json({ access_token: 'tok-1', expires_in: 86399 });
      }),
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, async ({ request }) => {
        expect(request.headers.get('x-shopify-access-token')).toBe('tok-1');
        const { variables } = (await request.json()) as { variables: { after: string | null; query: string } };
        queries.push(variables.query);
        const first = variables.after === null;
        return HttpResponse.json({
          data: {
            orders: {
              pageInfo: { hasNextPage: first, endCursor: first ? 'c1' : null },
              nodes: [{ ...order, id: first ? 'gid://shopify/Order/1' : 'gid://shopify/Order/2', updatedAt: first ? '2026-09-20T08:16:30Z' : '2026-09-21T09:00:00Z' }],
            },
          },
        });
      }),
    );
    const creds = store({ shopDomain: 'luora.myshopify.com', clientId: 'id', clientSecret: 'secret' });
    const adapter = new ShopifyAdapter(creds);
    const result = await adapter.syncOrders('2026-09-01T00:00:00Z');
    expect(result.orders.map((o) => o.externalId)).toEqual(['gid://shopify/Order/1', 'gid://shopify/Order/2']);
    expect(result.nextCursor).toBe('2026-09-21T09:00:00Z');
    expect(result.hasMore).toBe(false);
    expect(queries[0]).toBe("updated_at:>='2026-09-01T00:00:00Z'");
    expect(tokenCalls).toBe(1);
    expect(creds.saved[0].accessToken).toBe('tok-1');
  });

  it('reads the product metafields asked for with the variant details, only the filled-in ones', async () => {
    const asked: { keys: string[]; withMeta: boolean }[] = [];
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, async ({ request }) => {
        const { variables } = (await request.json()) as { variables: { keys: string[]; withMeta: boolean } };
        asked.push({ keys: variables.keys, withMeta: variables.withMeta });
        return HttpResponse.json({
          data: {
            nodes: [
              {
                id: 'gid://shopify/ProductVariant/1',
                sku: 'LUO-1',
                barcode: '5901234567890',
                price: '49.99',
                displayName: 'Cream',
                image: null,
                inventoryItem: { measurement: { weight: { value: 120, unit: 'GRAMS' } } },
                product: {
                  title: 'Cream',
                  descriptionHtml: '<p>x</p>',
                  vendor: 'Luora',
                  productType: '',
                  images: { nodes: [] },
                  ...(variables.withMeta
                    ? {
                        metafields: {
                          nodes: [
                            // As Shopify really answers a `keys: ["namespace.key"]` request: the key comes back with its namespace.
                            { namespace: 'custom', key: 'custom.responsible_person', value: ' Jan Kowalski, Warszawa ' },
                            { namespace: 'custom', key: 'custom.empty', value: ' ' },
                            // And a plain key still gets its namespace.
                            { namespace: 'custom', key: 'responsible_person_address', value: 'Warszawa' },
                          ],
                        },
                      }
                    : {}),
                },
              },
            ],
          },
        });
      }),
    );
    const adapter = new ShopifyAdapter(store({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' }));
    const withMeta = await adapter.variantDetails(['gid://shopify/ProductVariant/1'], ['custom.responsible_person', 'custom.empty']);
    expect(withMeta.get('gid://shopify/ProductVariant/1')?.metafields).toEqual({
      'custom.responsible_person': 'Jan Kowalski, Warszawa',
      'custom.responsible_person_address': 'Warszawa',
    });
    const without = await adapter.variantDetails(['gid://shopify/ProductVariant/1']);
    expect(without.get('gid://shopify/ProductVariant/1')?.metafields).toEqual({});
    expect(asked).toEqual([
      { keys: ['custom.responsible_person', 'custom.empty'], withMeta: true },
      { keys: [], withMeta: false },
    ]);
  });

  it('retries when throttled', async () => {
    let calls = 0;
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, () => {
        calls++;
        if (calls === 1) return HttpResponse.json({ errors: [{ message: 'Throttled', extensions: { code: 'THROTTLED' } }] });
        return HttpResponse.json({ data: { shop: { name: 'Luora', myshopifyDomain: 'luora.myshopify.com' }, locations: { nodes: [] } } });
      }),
    );
    const adapter = new ShopifyAdapter(store({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_legacy' }));
    expect(await adapter.checkConnection()).toBe('Luora (luora.myshopify.com)');
    expect(calls).toBe(2);
  });

  it('fulfils open fulfillment orders with tracking, and skips when nothing is open', async () => {
    const mutations: unknown[] = [];
    let open = true;
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, async ({ request }) => {
        const { query, variables } = (await request.json()) as { query: string; variables: Record<string, unknown> };
        if (query.includes('fulfillmentOrders')) {
          return HttpResponse.json({
            data: { order: { id: 'o', fulfillmentOrders: { nodes: [{ id: 'fo-1', status: open ? 'OPEN' : 'CLOSED' }, { id: 'fo-2', status: 'CLOSED' }] } } },
          });
        }
        mutations.push(variables);
        return HttpResponse.json({ data: { fulfillmentCreate: { fulfillment: { id: 'f', status: 'SUCCESS' }, userErrors: [] } } });
      }),
    );
    const adapter = new ShopifyAdapter(store({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' }));
    const ref = { externalId: 'gid://shopify/Order/1', externalNumber: '#1', raw: {}, items: [] };
    const tracking = { carrier: 'inpost' as const, carrierName: 'InPost', trackingNumber: '620000000000000000000001', trackingUrl: 'https://inpost.pl/x' };
    await adapter.pushTracking(ref, tracking);
    expect(mutations).toEqual([
      {
        fulfillment: {
          lineItemsByFulfillmentOrder: [{ fulfillmentOrderId: 'fo-1' }],
          trackingInfo: { company: 'InPost', number: '620000000000000000000001', url: 'https://inpost.pl/x' },
          notifyCustomer: true,
        },
      },
    ]);
    open = false;
    await adapter.pushTracking(ref, tracking);
    expect(mutations).toHaveLength(1);
  });

  it('sets stock with the compare-and-swap check disabled', async () => {
    let input: { quantities: Record<string, unknown>[] } | undefined;
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, async ({ request }) => {
        const body = (await request.json()) as { query: string; variables: { input: typeof input; key: string } };
        input = body.variables.input;
        // Since API 2026-04 the mutation is refused without an idempotency key.
        expect(body.query).toContain('@idempotent(key: $key)');
        expect(body.variables.key).toMatch(/^[0-9a-f-]{36}$/);
        return HttpResponse.json({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: { id: 'g' }, userErrors: [] } } });
      }),
    );
    const adapter = new ShopifyAdapter(store({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' }), { locationId: 'gid://shopify/Location/1' });
    expect(await adapter.setStock([{ externalId: 'v', sku: 'A', ref: { inventoryItemId: 'gid://shopify/InventoryItem/111' }, quantity: 7 }])).toEqual([]);
    expect(input?.quantities).toEqual([{ inventoryItemId: 'gid://shopify/InventoryItem/111', locationId: 'gid://shopify/Location/1', quantity: 7, changeFromQuantity: null }]);
  });
});

describe('ShopifyAdapter.setStock with a bundle', () => {
  it('sends the rest again without the items Shopify refuses, and flags a bundle as managed by Shopify', async () => {
    const calls: { inventoryItemId: string }[][] = [];
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, async ({ request }) => {
        const body = (await request.json()) as { variables: { input: { quantities: { inventoryItemId: string }[] } } };
        const quantities = body.variables.input.quantities;
        calls.push(quantities);
        const bundle = quantities.findIndex((q) => q.inventoryItemId.endsWith('/2'));
        const userErrors =
          bundle >= 0
            ? [{ field: ['input', 'quantities', String(bundle), 'inventoryItemId'], message: 'The specified inventory item is not allowed to be adjusted via API. Example: if the inventory item is a parent bundle.', code: 'NON_MUTABLE_INVENTORY_ITEM' }]
            : [];
        return HttpResponse.json({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: userErrors.length ? null : { id: 'g' }, userErrors } } });
      }),
    );
    const adapter = new ShopifyAdapter(store({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' }), { locationId: 'gid://shopify/Location/1' });
    const item = (n: number) => ({ externalId: `v${n}`, sku: null, ref: { inventoryItemId: `gid://shopify/InventoryItem/${n}` }, quantity: n });
    const failures = await adapter.setStock([item(1), item(2), item(3)]);
    expect(calls.map((c) => c.map((q) => q.inventoryItemId.split('/').pop()))).toEqual([['1', '2', '3'], ['1', '3']]);
    expect(failures).toEqual([{ externalId: 'v2', message: expect.stringContaining('parent bundle'), managed: true }]);
  });

  it('fails the call when Shopify names no item', async () => {
    server.use(
      http.post(`${SHOP}/admin/api/2026-07/graphql.json`, () =>
        HttpResponse.json({ data: { inventorySetQuantities: { inventoryAdjustmentGroup: null, userErrors: [{ field: null, message: 'Location not found' }] } } }),
      ),
    );
    const adapter = new ShopifyAdapter(store({ shopDomain: 'luora.myshopify.com', accessToken: 'shpat_x' }), { locationId: 'gid://shopify/Location/1' });
    await expect(adapter.setStock([{ externalId: 'v', sku: null, ref: { inventoryItemId: 'gid://shopify/InventoryItem/1' }, quantity: 1 }])).rejects.toThrow('Location not found');
  });
});

describe('webhook signature', () => {
  it('accepts the right HMAC only', () => {
    const body = '{"id":1}';
    const hmac = createHmac('sha256', 'secret').update(body).digest('base64');
    expect(validShopifyHmac(body, hmac, 'secret')).toBe(true);
    expect(validShopifyHmac(body, hmac, 'other')).toBe(false);
    expect(validShopifyHmac(body, null, 'secret')).toBe(false);
  });
});
