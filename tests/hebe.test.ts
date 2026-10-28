import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import order from './fixtures/empik/order.json';
import { HEBE, HebeAdapter } from '@/server/integrations/marketplaces/hebe/adapter';
import { buildOfferCsv, resolveMiraklCarrier } from '@/server/integrations/marketplaces/mirakl/adapter';
import { mapMiraklOrder } from '@/server/integrations/marketplaces/mirakl/mapper';
import { offerFieldMetafieldKeys, resolveOfferFields, unsourcedRequiredFields } from '@/server/integrations/marketplaces/mirakl/offer-fields';
import type { MarketplaceSettings } from '@/server/db/schema';
import type { OfferDraft } from '@/server/integrations/marketplaces/types';
import { httpConfig } from '@/server/http';

// HEBE runs on Mirakl like Empik, so an Empik order payload is a HEBE order payload too.
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
beforeEach(() => {
  httpConfig.sleep = async () => {};
});

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

// HEBE's real carrier list (SH21): one InPost carrier for lockers and couriers alike, codes with a country suffix.
const HEBE_CARRIERS = [
  { code: 'dhl-pl', label: 'DHL Poland', tracking_url: null },
  { code: 'dpd-pl', label: 'DPD Poland', tracking_url: null },
  { code: 'fedex-pl', label: 'Fedex Poland', tracking_url: null },
  { code: 'gls', label: 'GLS', tracking_url: null },
  { code: 'inpost-pl', label: 'Inpost Pologne', tracking_url: null },
  { code: 'pl-post', label: 'Poczta Polska', tracking_url: null },
  { code: 'ups', label: 'UPS', tracking_url: null },
];

describe('HEBE carriers', () => {
  const ref = { externalId: '210045-A', externalNumber: '210045', raw: order, items: [] };
  function send(tracking: Parameters<HebeAdapter['pushTracking']>[1]) {
    const calls: string[] = [];
    server.use(
      http.get(`${BASE}/api/shipping/carriers`, () => HttpResponse.json({ carriers: HEBE_CARRIERS })),
      http.get(`${BASE}/api/orders`, () => HttpResponse.json({ orders: [order], total_count: 1 })),
      http.put(`${BASE}/api/orders/:id/tracking`, async ({ request }) => {
        calls.push(JSON.stringify(await request.json()));
        return new HttpResponse(null, { status: 204 });
      }),
      http.put(`${BASE}/api/orders/:id/ship`, () => new HttpResponse(null, { status: 204 })),
    );
    return new HebeAdapter(creds).pushTracking(ref, tracking).then(() => calls);
  }

  it('sends InPost Paczkomat and courier labels with HEBE’s single InPost carrier', async () => {
    expect(await send({ carrier: 'inpost', carrierName: 'InPost', service: 'inpost_locker_standard', trackingNumber: '62001' })).toEqual(['{"carrier_code":"inpost-pl","tracking_number":"62001"}']);
    expect(await send({ carrier: 'inpost', carrierName: 'InPost', service: 'inpost_courier_standard', trackingNumber: '52000' })).toEqual(['{"carrier_code":"inpost-pl","tracking_number":"52000"}']);
  });

  it('maps the carriers Allegro Delivery reports to HEBE’s codes', async () => {
    const as = (carrierCode: string) => send({ carrier: 'allegro_shipping', carrierCode, carrierName: carrierCode, trackingNumber: '9' });
    expect(await as('DPD')).toEqual(['{"carrier_code":"dpd-pl","tracking_number":"9"}']);
    expect(await as('POCZTA_POLSKA')).toEqual(['{"carrier_code":"pl-post","tracking_number":"9"}']);
    expect(await as('GLS')).toEqual(['{"carrier_code":"gls","tracking_number":"9"}']);
  });

  it('sends a carrier HEBE does not list as an unregistered one', async () => {
    expect(await send({ carrier: 'allegro_shipping', carrierCode: 'ORLEN', carrierName: 'Orlen Paczka', trackingNumber: '7', trackingUrl: 'https://orlen.test/7' })).toEqual([
      '{"carrier_name":"Orlen Paczka","carrier_url":"https://orlen.test/7","tracking_number":"7"}',
    ]);
  });

  it('matches a code with a country suffix, and a lone InPost carrier for both kinds', () => {
    expect(resolveMiraklCarrier(['dpd'], HEBE_CARRIERS, null)?.code).toBe('dpd-pl');
    expect(resolveMiraklCarrier([], HEBE_CARRIERS, 'inpostLocker')?.code).toBe('inpost-pl');
    expect(resolveMiraklCarrier([], HEBE_CARRIERS, 'inpostCourier')?.code).toBe('inpost-pl');
    // Two letters is too short to guess from.
    expect(resolveMiraklCarrier(['pl'], HEBE_CARRIERS, null)).toBeNull();
    // A marketplace that has a courier InPost only must not get a locker label sent to it.
    expect(resolveMiraklCarrier([], [{ code: 'inpost-kurier', label: 'InPost Kurier' }], 'inpostLocker')).toBeNull();
  });
});

// HEBE asks for a "responsible person" (GPSR) on every offer. It is an extra offer field that Mirakl lists (AF01).
const PERSON = { code: 'responsible-person', label: 'Osoba odpowiedzialna', type: 'STRING', required: true };
const SAFETY = { code: 'safety-class', label: 'Klasa', type: 'LIST', required: false, acceptedValues: ['A', 'B'] };
const offerDraft: OfferDraft = {
  sku: 'LUO-1',
  ean: '5901234567890',
  name: 'Cream',
  descriptionHtml: '<p>x</p>',
  brand: 'Luora',
  imageUrls: [],
  weightGrams: 120,
  quantity: 7,
  price: '49.99',
  currency: 'PLN',
};

describe('HEBE extra offer fields', () => {
  const settings: MarketplaceSettings = {
    offerFieldCache: { fetchedAt: '2026-10-24T00:00:00Z', fields: [PERSON, SAFETY] },
    offerFieldSources: { 'responsible-person': { metafield: ' custom.responsible_person ', fallback: 'Luora Sp. z o.o., Kraków' } },
  };

  it('reads the offer fields with AF01, drops the ones a seller cannot edit, and caches them for a day', async () => {
    let calls = 0;
    server.use(
      http.get(`${BASE}/api/additional_fields`, ({ request }) => {
        calls++;
        expect(new URL(request.url).searchParams.get('entities')).toBe('OFFER');
        return HttpResponse.json({
          total_count: 3,
          additional_fields: [
            { code: 'responsible-person', label: 'Osoba odpowiedzialna', type: 'STRING', required: true, editable: true },
            { code: 'safety-class', label: 'Klasa', type: 'LIST', required: false, editable: true, accepted_values: ['A', 'B'], default_value: 'A' },
            { code: 'internal', label: 'Internal', type: 'STRING', required: true, editable: false },
          ],
        });
      }),
    );
    const saved: MarketplaceSettings[] = [];
    const adapter = new HebeAdapter(creds, {}, async (next) => void saved.push(next));
    const fields = await adapter.offerFields();
    expect(fields).toEqual([
      { code: 'responsible-person', label: 'Osoba odpowiedzialna', type: 'STRING', required: true, description: null, defaultValue: null },
      { code: 'safety-class', label: 'Klasa', type: 'LIST', required: false, description: null, defaultValue: 'A', acceptedValues: ['A', 'B'] },
    ]);
    await adapter.offerFields();
    expect(calls).toBe(1);
    expect(saved).toHaveLength(1);
    expect(saved[0].offerFieldCache?.fields).toHaveLength(2);
    await adapter.offerFields(true);
    expect(calls).toBe(2);
  });

  it('takes the product’s metafield first, then the fixed text', () => {
    expect(offerFieldMetafieldKeys(settings)).toEqual(['custom.responsible_person']);
    expect(resolveOfferFields(settings, { 'custom.responsible_person': ' Jan Kowalski, Warszawa ' })).toEqual({ values: { 'responsible-person': 'Jan Kowalski, Warszawa' }, problems: [] });
    expect(resolveOfferFields(settings, {}).values).toEqual({ 'responsible-person': 'Luora Sp. z o.o., Kraków' });
  });

  it('joins several metafields (name, then address) and needs all of them on the product', () => {
    const joined: MarketplaceSettings = {
      ...settings,
      offerFieldSources: { 'responsible-person': { metafield: 'custom.responsible_person, custom.responsible_person_address' } },
    };
    expect(offerFieldMetafieldKeys(joined)).toEqual(['custom.responsible_person', 'custom.responsible_person_address']);
    expect(resolveOfferFields(joined, { 'custom.responsible_person': 'Belab Services SL', 'custom.responsible_person_address': '7 Monaco Av., Barcelona, Spain' }).values).toEqual({
      'responsible-person': 'Belab Services SL, 7 Monaco Av., Barcelona, Spain',
    });
    // A name without its address is not a usable responsible person.
    expect(resolveOfferFields(joined, { 'custom.responsible_person': 'Belab Services SL' })).toEqual({ values: {}, problems: ['no Osoba odpowiedzialna'] });
  });

  it('flags a product with nothing to send for a required field, and a value a list does not accept', () => {
    const noFallback: MarketplaceSettings = { ...settings, offerFieldSources: { 'responsible-person': { metafield: 'custom.responsible_person' } } };
    expect(resolveOfferFields(noFallback, {})).toEqual({ values: {}, problems: ['no Osoba odpowiedzialna'] });
    const wrongList: MarketplaceSettings = { ...settings, offerFieldSources: { ...settings.offerFieldSources, 'safety-class': { fallback: 'Z' } } };
    expect(resolveOfferFields(wrongList, {}).problems).toEqual(['Klasa "Z" is not accepted']);
  });

  it('stops publishing until every required field has a source', () => {
    expect(unsourcedRequiredFields({ offerFieldCache: settings.offerFieldCache }).map((f) => f.code)).toEqual(['responsible-person']);
    expect(unsourcedRequiredFields(settings)).toEqual([]);
    expect(new HebeAdapter(creds, { offerFieldCache: settings.offerFieldCache }).publishSetupProblems()).toEqual(['choose where "Osoba odpowiedzialna" comes from']);
    expect(new HebeAdapter(creds, settings).publishSetupProblems()).toEqual([]);
    expect(new HebeAdapter(creds, {}).publishSetupProblems()).toEqual([]);
  });

  it('adds the fields to the offer file as columns named by their code', () => {
    expect(buildOfferCsv({ ...offerDraft, extraFields: { 'responsible-person': 'Jan "JK" Kowalski', 'safety-class': '' } }, '11', 2)).toBe(
      '"sku";"product-id";"product-id-type";"price";"quantity";"state";"leadtime-to-ship";"update-delete";"responsible-person"\n"LUO-1";"5901234567890";"EAN";"49.99";"7";"11";"2";"update";"Jan ""JK"" Kowalski"\n',
    );
    expect(buildOfferCsv(offerDraft, '11', 2).split('\n')[0]).not.toContain('responsible');
  });

  it('sends the responsible person with the offer (OF01)', async () => {
    let csv = '';
    server.use(
      http.post(`${BASE}/api/offers/imports`, async ({ request }) => {
        csv = await ((await request.formData()).get('file') as File).text();
        return HttpResponse.json({ import_id: 9 });
      }),
      http.get(`${BASE}/api/offers/imports/9`, () => HttpResponse.json({ status: 'COMPLETE', lines_in_error: 0, has_error_report: false })),
    );
    await new HebeAdapter(creds).createOffer({ ...offerDraft, extraFields: { 'responsible-person': 'Jan Kowalski' } });
    expect(csv).toContain('"responsible-person"');
    expect(csv).toContain('"update";"Jan Kowalski"');
  });
});

describe('HEBE price updates', () => {
  it('sends only SKU and price, as a NORMAL import (HEBE refuses "PARTIAL")', async () => {
    let csv = '';
    let mode: FormDataEntryValue | null = null;
    server.use(
      http.post(`${BASE}/api/offers/imports`, async ({ request }) => {
        const form = await request.formData();
        mode = form.get('import_mode');
        // Mirakl's own check: only NORMAL and REPLACE are valid.
        if (mode !== 'NORMAL' && mode !== 'REPLACE') return HttpResponse.json({ message: `Value '${mode}' is not valid for parameter 'import_mode'`, status: 400 }, { status: 400 });
        csv = await (form.get('file') as File).text();
        return HttpResponse.json({ import_id: 11 });
      }),
      http.get(`${BASE}/api/offers/imports/11`, () => HttpResponse.json({ status: 'COMPLETE', lines_in_error: 0, has_error_report: false })),
    );
    const failures = await new HebeAdapter(creds).setPrices([{ externalId: '1', sku: 'AREN-VCSR30', ean: '8809562192770', ref: { shopSku: 'AREN-VCSR30' }, price: '74.90', currency: 'PLN' }]);
    expect(failures).toEqual([]);
    expect(mode).toBe('NORMAL');
    expect(csv).toBe('"sku";"price";"update-delete"\n"AREN-VCSR30";"74.90";"update"\n');
  });
});
