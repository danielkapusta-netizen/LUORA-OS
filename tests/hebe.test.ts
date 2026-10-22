import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import order from './fixtures/empik/order.json';
import { HEBE, HebeAdapter } from '@/server/integrations/marketplaces/hebe/adapter';
import { mapMiraklOrder } from '@/server/integrations/marketplaces/mirakl/mapper';

// HEBE runs on Mirakl like Empik, so an Empik order payload is a HEBE order payload too.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://hebe.mirakl.test';
const creds = { baseUrl: BASE, apiKey: 'hebe-key' };

const withCommission = {
  ...order,
  order_lines: order.order_lines.map((l) => ({ ...l, commission_fee: 10, commission_vat: 2.3, total_commission: 12.3 })),
};

describe('mapMiraklOrder for HEBE', () => {
  it('labels HEBE’s commission as HEBE’s', () => {
    const o = mapMiraklOrder(withCommission, BASE, HEBE);
    expect(o.fees?.map((f) => [f.label, f.amount])).toEqual([
      ['Prowizja HEBE', '12.30'],
      ['Prowizja HEBE', '12.30'],
    ]);
  });

  it('reads the tax number from whichever field HEBE names it', () => {
    const o = mapMiraklOrder(
      {
        ...order,
        customer: { ...order.customer, billing_address: { company: 'Salon Urody Anna', street_1: 'Długa 5', zip_code: '31147', city: 'Kraków', country_iso_code: 'POL' } },
        order_additional_fields: [
          { code: 'vat-number', type: 'STRING', value: ' ' },
          { code: 'company-nip', type: 'STRING', value: 'PL6770065406' },
        ],
      },
      BASE,
      HEBE,
    );
    expect(o.invoiceRequest).toMatchObject({ name: 'Salon Urody Anna', taxId: '6770065406', euPrefix: 'PL', postalCode: '31-147' });
    expect(mapMiraklOrder(order, BASE, HEBE).invoiceRequest).toBeNull();
  });

  it('reads the Paczkomat from a pickup-point field when shipping_pudo_id is empty', () => {
    const o = mapMiraklOrder({ ...order, shipping_pudo_id: null, order_additional_fields: [{ code: 'pickup-point-id', type: 'STRING', value: 'krk01m' }] }, BASE, HEBE);
    expect(o.pickupPointId).toBe('KRK01M');
  });

  it('names an unnamed recipient after HEBE', () => {
    const o = mapMiraklOrder(
      { ...order, customer: { firstname: null, lastname: null, shipping_address: { ...order.customer.shipping_address, firstname: null, lastname: null } } },
      BASE,
      HEBE,
    );
    expect(o.shippingAddress.name).toBe('HEBE buyer');
  });
});

describe('HebeAdapter', () => {
  it('is the hebe marketplace and checks the connection with A01', async () => {
    server.use(
      http.get(`${BASE}/api/account`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('hebe-key');
        return HttpResponse.json({ shop_id: 2001, shop_name: 'Luora' });
      }),
    );
    const adapter = new HebeAdapter(creds);
    expect(adapter.marketplace).toBe('hebe');
    expect(await adapter.checkConnection()).toBe('HEBE: Luora');
  });

  it('reads orders with OR11 and maps them with HEBE’s field names', async () => {
    server.use(
      http.get(`${BASE}/api/orders`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('start_update_date')).toBe('2026-09-01T00:00:00Z');
        return HttpResponse.json({ orders: [withCommission, { ...order, order_id: 'staged', order_state: 'STAGING' }], total_count: 2 });
      }),
    );
    const result = await new HebeAdapter(creds).syncOrders('2026-09-01T00:00:00Z');
    expect(result.orders.map((o) => o.externalId)).toEqual(['210045-A']);
    expect(result.orders[0].fees?.[0].label).toBe('Prowizja HEBE');
    expect(result.nextCursor).toBe(order.last_updated_date);
  });

  // HEBE's list (SH21) is all there is: it publishes no carrier coding of its own.
  const CARRIERS = [
    { code: 'DPD_PL', label: 'DPD Polska', tracking_url: null },
    { code: 'INPOST_LOCKER', label: 'InPost Paczkomat', tracking_url: null },
    { code: 'INPOST_COURIER', label: 'InPost Kurier', tracking_url: null },
    { code: 'GLS', label: 'GLS', tracking_url: null },
  ];

  function trackingServer(carriers: typeof CARRIERS | null = CARRIERS) {
    const calls: string[] = [];
    server.use(
      http.get(`${BASE}/api/shipping/carriers`, () => (carriers ? HttpResponse.json({ carriers }) : HttpResponse.json({ message: 'down' }, { status: 500 }))),
      http.get(`${BASE}/api/orders`, () => HttpResponse.json({ orders: [order], total_count: 1 })),
      http.put(`${BASE}/api/orders/:id/tracking`, async ({ request, params }) => {
        calls.push(`tracking ${params.id} ${JSON.stringify(await request.json())}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.put(`${BASE}/api/orders/:id/ship`, ({ params }) => {
        calls.push(`ship ${params.id}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return calls;
  }
  const ref = { externalId: '210045-A', externalNumber: '210045', raw: order, items: [] };
  const locker = { carrier: 'inpost' as const, carrierName: 'InPost', service: 'inpost_locker_standard', trackingNumber: '62001' };
  const courier = { carrier: 'inpost' as const, carrierName: 'InPost', service: 'inpost_courier_standard', trackingNumber: '52000' };

  it('picks InPost locker vs courier from HEBE’s list (OR23), then ships (OR24)', async () => {
    const calls = trackingServer();
    const adapter = new HebeAdapter(creds);
    await adapter.pushTracking(ref, locker);
    await adapter.pushTracking(ref, courier);
    expect(calls).toEqual([
      'tracking 210045-A {"carrier_code":"INPOST_LOCKER","tracking_number":"62001"}',
      'ship 210045-A',
      'tracking 210045-A {"carrier_code":"INPOST_COURIER","tracking_number":"52000"}',
      'ship 210045-A',
    ]);
  });

  it('finds another carrier by the name it reported', async () => {
    const calls = trackingServer();
    await new HebeAdapter(creds).pushTracking(ref, { carrier: 'allegro_shipping', carrierCode: 'GLS', carrierName: 'GLS', trackingNumber: '9' });
    expect(calls[0]).toBe('tracking 210045-A {"carrier_code":"GLS","tracking_number":"9"}');
  });

  it('sends a carrier HEBE does not list as an unregistered one, with the tracking link', async () => {
    const calls = trackingServer();
    await new HebeAdapter(creds).pushTracking(ref, { carrier: 'allegro_shipping', carrierCode: 'UPS', carrierName: 'UPS', trackingNumber: '1Z', trackingUrl: 'https://ups.test/1Z' });
    expect(calls[0]).toBe('tracking 210045-A {"carrier_name":"UPS","carrier_url":"https://ups.test/1Z","tracking_number":"1Z"}');
  });

  it('uses the carrier code chosen in settings when the list can’t be read', async () => {
    const calls = trackingServer(null);
    await new HebeAdapter(creds, { carrierCodes: { inpostLocker: 'INPOST_LOCKER' } }).pushTracking(ref, locker);
    expect(calls[0]).toBe('tracking 210045-A {"carrier_code":"INPOST_LOCKER","tracking_number":"62001"}');
  });

  it('puts HEBE’s name on its errors', async () => {
    server.use(http.get(`${BASE}/api/account`, () => HttpResponse.json({ message: 'Unauthorized', status: 401 }, { status: 401 })));
    await expect(new HebeAdapter(creds).checkConnection()).rejects.toThrow('HEBE (HTTP 401): Unauthorized');
  });

  it('updates stock with an STO01 CSV upload', async () => {
    let csv = '';
    server.use(
      http.post(`${BASE}/api/offers/stock/imports`, async ({ request }) => {
        csv = await ((await request.formData()).get('file') as File).text();
        return HttpResponse.json({ import_id: 7 });
      }),
    );
    await new HebeAdapter(creds).setStock([{ externalId: '1', sku: 'LUO-1', ref: { shopSku: 'LUO-1' }, quantity: 4 }]);
    expect(csv).toContain('"LUO-1";"4";"";"update"');
  });
});
