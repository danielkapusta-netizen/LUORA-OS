import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import order from './fixtures/empik/order.json';
import { buildStockCsv, EmpikAdapter, empikCarrierCode, resolveEmpikCarrier } from '@/server/integrations/marketplaces/empik/adapter';
import { mapMiraklOrder, toAlpha2 } from '@/server/integrations/marketplaces/empik/mapper';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const BASE = 'https://marketplace.empik.test';
const creds = { baseUrl: BASE, apiKey: 'key-123' };

describe('mapMiraklOrder', () => {
  it('normalises an Empik order', () => {
    const o = mapMiraklOrder(order);
    expect(o).toMatchObject({
      externalId: '210045-A',
      externalNumber: '210045',
      readyToShip: true,
      pickupPointId: 'WAW01A',
      totalAmount: '108.80',
      shippingAmount: '9.00',
    });
    expect(o.shippingAddress).toMatchObject({ street: 'Marszałkowska 10 m. 4', postalCode: '00-590', countryCode: 'PL' });
    expect(o.items.map((i) => [i.sku, i.quantity, i.unitPrice])).toEqual([
      ['LUO-NTB-A5', 2, '29.90'],
      ['LUO-BAG-01', 1, '40.00'],
    ]);
  });

  it('reads the buyer’s Paczkomat from the "delivery-point-name" field when shipping_pudo_id is empty', () => {
    const o = mapMiraklOrder({
      ...order,
      shipping_pudo_id: null,
      shipping_type_code: 'PACKSTATION',
      order_additional_fields: [
        { code: 'order-type', type: 'LIST', value: 'Premium' },
        { code: 'delivery-point-name', type: 'STRING', value: ' waw190m ' },
      ],
    });
    expect(o.pickupPointId).toBe('WAW190M');
    expect(mapMiraklOrder({ ...order, shipping_pudo_id: null }).pickupPointId).toBeNull();
  });

  it('ships a Paczkomat order to the buyer, not to the locker code Empik puts in the surname', () => {
    const o = mapMiraklOrder({
      ...order,
      shipping_pudo_id: null,
      customer: { ...order.customer, firstname: 'Viktoria', lastname: 'Voukava', shipping_address: { ...order.customer.shipping_address, firstname: null, lastname: 'WAW102BAPP' } },
      order_additional_fields: [{ code: 'delivery-point-name', type: 'STRING', value: 'WAW102BAPP' }],
    });
    expect(o.shippingAddress.name).toBe('Viktoria Voukava');
    expect(o.buyer.name).toBe('Viktoria Voukava');
    expect(o.pickupPointId).toBe('WAW102BAPP');
  });

  it('reads an invoice request from the "nip" field and the billing company', () => {
    expect(mapMiraklOrder(order).invoiceRequest).toBeNull();
    const o = mapMiraklOrder({
      ...order,
      customer: { ...order.customer, billing_address: { company: 'Salon Urody Anna', street_1: 'Długa 5', zip_code: '31147', city: 'Kraków', country_iso_code: 'POL' } },
      order_additional_fields: [{ code: 'nip', type: 'STRING', value: '6770065406' }],
    });
    expect(o.invoiceRequest).toMatchObject({ name: 'Salon Urody Anna', taxId: '6770065406', euPrefix: null, street: 'Długa 5', postalCode: '31-147', city: 'Kraków', countryCode: 'PL' });
  });

  it('turns Empik’s relative photo paths into full URLs', () => {
    const withMedia = {
      ...order,
      order_lines: [{ ...order.order_lines[0], product_medias: [{ media_url: '/media/product/image/abc', type: 'SMALL' }] }],
    };
    expect(mapMiraklOrder(withMedia, 'https://marketplace.empik.com/api').items[0].imageUrl).toBe('https://marketplace.empik.com/media/product/image/abc');
    expect(mapMiraklOrder(withMedia).items[0].imageUrl).toBeNull();
  });

  it('is not shippable until accepted and paid', () => {
    expect(mapMiraklOrder({ ...order, order_state: 'WAITING_ACCEPTANCE' }).readyToShip).toBe(false);
    expect(mapMiraklOrder({ ...order, order_state: 'CANCELED' }).cancelled).toBe(true);
  });

  it('converts ISO alpha-3 country codes', () => {
    expect(toAlpha2('POL')).toBe('PL');
    expect(toAlpha2('de')).toBe('DE');
  });
});

describe('EmpikAdapter', () => {
  it('pages through OR11 with the API key', async () => {
    server.use(
      http.get(`${BASE}/api/orders`, ({ request }) => {
        expect(request.headers.get('authorization')).toBe('key-123');
        const offset = Number(new URL(request.url).searchParams.get('offset'));
        const page = offset === 0 ? [order, { ...order, order_id: 'staged', order_state: 'STAGING' }] : [{ ...order, order_id: '210046-A', last_updated_date: '2026-09-23T08:00:00Z' }];
        return HttpResponse.json({ orders: offset < 200 ? page : [], total_count: 101 });
      }),
    );
    const result = await new EmpikAdapter(creds).syncOrders('2026-09-01T00:00:00Z');
    expect(result.orders.map((o) => o.externalId)).toEqual(['210045-A', '210046-A']);
    expect(result.nextCursor).toBe('2026-09-23T08:00:00Z');
  });

  // Empik's real list (SH21). The courier code deliberately differs from the help-centre table
  // to prove the list, not the table, decides.
  const CARRIERS = [
    { code: 'dpd', label: 'DPD', tracking_url: null },
    { code: 'paczkomatyinpost', label: 'PACZKOMATY INPOST', tracking_url: null },
    { code: 'inpost-kurier', label: 'INPOST - Paczka kurierska', tracking_url: null },
  ];

  function trackingServer(state = { value: 'SHIPPING' }, carriers = CARRIERS) {
    const calls: string[] = [];
    let sh21 = 0;
    server.use(
      http.get(`${BASE}/api/shipping/carriers`, () => {
        sh21++;
        return HttpResponse.json({ carriers });
      }),
      http.get(`${BASE}/api/orders`, () => HttpResponse.json({ orders: [{ ...order, order_state: state.value }], total_count: 1 })),
      http.put(`${BASE}/api/orders/:id/tracking`, async ({ request, params }) => {
        calls.push(`tracking ${params.id} ${JSON.stringify(await request.json())}`);
        return new HttpResponse(null, { status: 204 });
      }),
      http.put(`${BASE}/api/orders/:id/ship`, ({ params }) => {
        calls.push(`ship ${params.id}`);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    return { calls, sh21: () => sh21 };
  }
  const ref = { externalId: '210045-A', externalNumber: '210045', raw: order, items: [] };
  const locker = { carrier: 'inpost' as const, carrierName: 'InPost', service: 'inpost_locker_standard', trackingNumber: '62001' };
  const courier = { carrier: 'inpost' as const, carrierName: 'InPost', service: 'inpost_courier_standard', trackingNumber: '52000' };

  it('sends a carrier code from Empik’s list (OR23), then confirms shipment (OR24), once', async () => {
    const state = { value: 'SHIPPING' };
    const { calls } = trackingServer(state);
    const adapter = new EmpikAdapter(creds);
    await adapter.pushTracking(ref, locker);
    expect(calls).toEqual(['tracking 210045-A {"carrier_code":"paczkomatyinpost","tracking_number":"62001"}', 'ship 210045-A']);
    state.value = 'SHIPPED';
    await adapter.pushTracking(ref, locker);
    expect(calls).toHaveLength(2);
  });

  it('finds the courier carrier by label when the documented code is not on the list', async () => {
    const { calls } = trackingServer();
    await new EmpikAdapter(creds).pushTracking(ref, courier);
    expect(calls[0]).toBe('tracking 210045-A {"carrier_code":"inpost-kurier","tracking_number":"52000"}');
  });

  it('turns a label typed into settings ("PACZKOMATY INPOST") into its code', async () => {
    const { calls } = trackingServer();
    await new EmpikAdapter(creds, { carrierCodes: { inpostLocker: 'PACZKOMATY INPOST', inpost: 'PACZKOMATY INPOST' } }).pushTracking(ref, locker);
    expect(calls[0]).toBe('tracking 210045-A {"carrier_code":"paczkomatyinpost","tracking_number":"62001"}');
  });

  it('caches the carrier list and saves it on the account', async () => {
    const { sh21 } = trackingServer();
    const saved: unknown[] = [];
    const adapter = new EmpikAdapter(creds, {}, async (s) => void saved.push(s));
    await adapter.pushTracking(ref, locker);
    await adapter.pushTracking(ref, courier);
    expect(sh21()).toBe(1);
    expect(saved).toHaveLength(1);
  });

  it('refuses to send an InPost code Empik does not have, and lists what it has', async () => {
    const { calls } = trackingServer({ value: 'SHIPPING' }, [{ code: 'dpd', label: 'DPD', tracking_url: null }]);
    await expect(new EmpikAdapter(creds).pushTracking(ref, courier)).rejects.toThrow(/no carrier matching InPost courier.*dpd \(DPD\)/);
    expect(calls).toEqual([]);
  });

  it('resolves carriers in pure form', () => {
    expect(resolveEmpikCarrier(['inpost_paczka-kurierska'], CARRIERS, null)?.code).toBe('inpost-kurier');
    expect(resolveEmpikCarrier(['gls'], CARRIERS, null)).toBeNull();
    expect(resolveEmpikCarrier([null, 'Dpd'], CARRIERS, null)?.code).toBe('dpd');
    expect(resolveEmpikCarrier([], CARRIERS, 'inpostLocker')?.code).toBe('paczkomatyinpost');
  });

  it('maps carriers reported by Allegro Delivery', () => {
    expect(empikCarrierCode({ carrier: 'allegro_shipping', carrierCode: 'DPD', carrierName: 'x', trackingNumber: '1' })).toBe('dpd');
    expect(empikCarrierCode({ carrier: 'allegro_shipping', carrierCode: 'ORLEN', carrierName: 'x', trackingNumber: '1' })).toBe('ORLEN');
    expect(empikCarrierCode({ carrier: 'allegro_shipping', carrierCode: 'ALLEGRO', carrierName: 'x', trackingNumber: '1' })).toBeNull();
  });

  it('explains which step Empik rejected, with Empik’s message', async () => {
    server.use(
      http.get(`${BASE}/api/shipping/carriers`, () => HttpResponse.json({ carriers: CARRIERS })),
      http.get(`${BASE}/api/orders`, () => HttpResponse.json({ orders: [{ ...order }], total_count: 1 })),
      http.put(`${BASE}/api/orders/:id/tracking`, () => HttpResponse.json({ message: "Invalid value for field 'carrierCode'", status: 400 }, { status: 400 })),
    );
    await expect(new EmpikAdapter(creds).pushTracking(ref, locker)).rejects.toThrow(/OR23.*paczkomatyinpost.*Empik \(HTTP 400\): Invalid value/);
  });

  it('attaches the invoice as a CUSTOMER_INVOICE document (OR74), once', async () => {
    const uploads: { files: string[]; documents: unknown }[] = [];
    let listed: { file_name: string }[] = [];
    server.use(
      http.get(`${BASE}/api/orders/documents`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('order_ids')).toBe('210045-A');
        return HttpResponse.json({ order_documents: listed, total_count: listed.length });
      }),
      http.post(`${BASE}/api/orders/:id/documents`, async ({ request, params }) => {
        expect(params.id).toBe('210045-A');
        const form = await request.formData();
        const files = form.getAll('files').map((f) => (f as File).name);
        uploads.push({ files, documents: JSON.parse(await (form.get('order_documents') as Blob).text()) });
        return HttpResponse.json({ errors_count: 0, order_documents: [] });
      }),
    );
    const ref = { externalId: '210045-A', externalNumber: '210045', raw: order, items: [] };
    await new EmpikAdapter(creds).uploadInvoice(ref, { number: 'FV 7/10/2026', pdf: Buffer.from('%PDF-1.4') });
    expect(uploads).toEqual([
      { files: ['faktura-FV-7-10-2026.pdf'], documents: { order_documents: [{ file_name: 'faktura-FV-7-10-2026.pdf', type_code: 'CUSTOMER_INVOICE' }] } },
    ]);
    listed = [{ file_name: 'faktura-FV-7-10-2026.pdf' }];
    await new EmpikAdapter(creds).uploadInvoice(ref, { number: 'FV 7/10/2026', pdf: Buffer.from('%PDF-1.4') });
    expect(uploads).toHaveLength(1);
  });

  it('accepts every order line (OR21)', async () => {
    let body: unknown;
    server.use(
      http.put(`${BASE}/api/orders/210045-A/accept`, async ({ request }) => {
        body = await request.json();
        return new HttpResponse(null, { status: 204 });
      }),
    );
    await new EmpikAdapter(creds).acceptOrder({ externalId: '210045-A', externalNumber: '210045', raw: order, items: [{ externalLineId: '210045-A-1', quantity: 2 }] });
    expect(body).toEqual({ order_lines: [{ accepted: true, id: '210045-A-1' }] });
  });

  it('updates stock with an STO01 CSV upload', async () => {
    let csv = '';
    server.use(
      http.post(`${BASE}/api/offers/stock/imports`, async ({ request }) => {
        const form = await request.formData();
        csv = await (form.get('file') as File).text();
        return HttpResponse.json({ import_id: '77' }, { status: 201 });
      }),
    );
    await new EmpikAdapter(creds).setStock([{ externalId: '5551', sku: 'LUO-NTB-A5', ref: { shopSku: 'LUO-NTB-A5' }, quantity: 4 }]);
    expect(csv).toBe('"offer-sku";"quantity";"warehouse-code";"update-delete"\n"LUO-NTB-A5";"4";"";"update"\n');
  });

  it('never sends negative stock', () => {
    expect(buildStockCsv([{ externalId: '1', sku: 'A;B"C', ref: {}, quantity: -2 }])).toContain('"A;B""C";"0"');
  });
});
