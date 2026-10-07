// Creating offers on Allegro and Empik from Shopify products: the requests we send and how refusals read.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markupPrice } from '@/lib/offers';
import { allegroHandlingTime, AllegroAdapter } from '@/server/integrations/marketplaces/allegro/adapter';
import type { AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { buildOfferCsv, EmpikAdapter } from '@/server/integrations/marketplaces/empik/adapter';
import type { OfferDraft } from '@/server/integrations/marketplaces/types';
import { httpConfig } from '@/server/http';
import { publishPrice } from '@/server/services/marketplace-offers';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
beforeEach(() => {
  httpConfig.sleep = async () => {};
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const draft: OfferDraft = {
  sku: 'LUO-1',
  ean: '5901234567890',
  name: 'Cream',
  descriptionHtml: '<p>x</p>',
  brand: 'Luora',
  imageUrls: ['https://img/1.jpg'],
  weightGrams: 120,
  quantity: 7,
  price: '49.99',
  currency: 'PLN',
};

describe('offer prices', () => {
  it('adds the markup and rounds as configured', () => {
    expect(markupPrice('40', 10, 'x.99')).toBe('43.99');
    expect(markupPrice('40', 10, 'x.00')).toBe('44.00');
    expect(markupPrice('40.123', 0, 'none')).toBe('40.12');
    expect(publishPrice('50', {})).toBe('49.99');
    expect(publishPrice('50', { offerMarkupPercent: 20, offerRounding: 'x.00' })).toBe('60.00');
  });
});

describe('Allegro offers', () => {
  const API = 'https://api.allegro.pl.allegrosandbox.pl';
  const creds = () => {
    const c: AllegroCredentials = { clientId: 'a', clientSecret: 'b', sandbox: true, accessToken: 't', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
    return { get: () => c, save: async () => {} };
  };
  const settings = {
    allegroShippingRateId: 'rate-1',
    allegroReturnPolicyId: 'ret-1',
    allegroImpliedWarrantyId: 'imp-1',
    allegroLocation: { province: 'MAZOWIECKIE', city: 'Warszawa', postCode: '00-001' },
    offerHandlingDays: 2,
  };

  it('maps handling days onto the durations Allegro accepts', () => {
    expect([0, 1, 2, 3, 6, 100].map(allegroHandlingTime)).toEqual(['PT0S', 'PT24H', 'PT48H', 'P3D', 'P7D', 'P60D']);
  });

  it('lists what is still missing in the settings', () => {
    expect(new AllegroAdapter(creds(), {}).publishSetupProblems()).toHaveLength(4);
    expect(new AllegroAdapter(creds(), settings).publishSetupProblems()).toEqual([]);
  });

  it('finds the catalogue product by EAN', async () => {
    server.use(
      http.get(`${API}/sale/products`, ({ request }) => {
        const url = new URL(request.url);
        expect(url.searchParams.get('mode')).toBe('GTIN');
        return HttpResponse.json({ products: url.searchParams.get('phrase') === draft.ean ? [{ id: 'prod-9', name: 'Cream 50ml' }] : [] });
      }),
    );
    const found = await new AllegroAdapter(creds(), settings).checkCatalogue([draft.ean, '111']);
    expect(found.get(draft.ean)).toEqual({ found: true, ref: 'prod-9', name: 'Cream 50ml' });
    expect(found.get('111')).toEqual({ found: false });
  });

  it('creates the offer attached to the catalogue product, with the SKU as its external id', async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(`${API}/sale/product-offers`, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json({ id: 'offer-1' }, { status: 201 });
      }),
      http.get(`${API}/sale/product-offers/offer-1`, () => HttpResponse.json({ validation: { errors: [] }, publication: { status: 'ACTIVE' } })),
    );
    const result = await new AllegroAdapter(creds(), settings).createOffer(draft, { found: true, ref: 'prod-9' });
    expect(result).toEqual({ externalId: 'offer-1' });
    expect(body).toMatchObject({
      productSet: [{ product: { id: 'prod-9' } }],
      sellingMode: { format: 'BUY_NOW', price: { amount: '49.99', currency: 'PLN' } },
      stock: { available: 7, unit: 'UNIT' },
      external: { id: 'LUO-1' },
      delivery: { shippingRates: { id: 'rate-1' }, handlingTime: 'PT48H' },
      afterSalesServices: { impliedWarranty: { id: 'imp-1' }, returnPolicy: { id: 'ret-1' } },
      location: { countryCode: 'PL', province: 'MAZOWIECKIE', city: 'Warszawa', postCode: '00-001' },
      publication: { status: 'ACTIVE' },
    });
  });

  it('creates drafts when asked, and reports what Allegro rejects', async () => {
    let status = '';
    server.use(
      http.post(`${API}/sale/product-offers`, async ({ request }) => {
        status = ((await request.json()) as { publication: { status: string } }).publication.status;
        return HttpResponse.json({ id: 'offer-2' }, { status: 201 });
      }),
      http.get(`${API}/sale/product-offers/offer-2`, () => HttpResponse.json({ validation: { errors: [{ userMessage: 'Brakuje parametru', path: 'parameters' }] } })),
    );
    await expect(new AllegroAdapter(creds(), { ...settings, allegroCreateAsDraft: true }).createOffer(draft, { found: true, ref: 'p' })).rejects.toThrow('parameters: Brakuje parametru');
    expect(status).toBe('INACTIVE');
  });

  it('refuses without a catalogue product', async () => {
    await expect(new AllegroAdapter(creds(), settings).createOffer(draft, { found: false })).rejects.toThrow('not in the Allegro catalogue');
  });

  it('reads the choices for the settings page', async () => {
    server.use(
      http.get(`${API}/sale/shipping-rates`, () => HttpResponse.json({ shippingRates: [{ id: 's1', name: 'Standard', extra: 1 }] })),
      http.get(`${API}/after-sales-service-conditions/return-policies`, () => HttpResponse.json({ returnPolicies: [{ id: 'r1', name: '14 days' }] })),
      http.get(`${API}/after-sales-service-conditions/implied-warranties`, () => HttpResponse.json({ impliedWarranties: [{ id: 'i1', name: 'Reklamacje' }] })),
      http.get(`${API}/after-sales-service-conditions/warranties`, () => HttpResponse.json({ warranties: [] })),
    );
    expect(await new AllegroAdapter(creds(), settings).publishOptions()).toEqual({
      shippingRates: [{ id: 's1', name: 'Standard' }],
      returnPolicies: [{ id: 'r1', name: '14 days' }],
      impliedWarranties: [{ id: 'i1', name: 'Reklamacje' }],
      warranties: [],
    });
  });
});

describe('Empik offers', () => {
  const BASE = 'https://marketplace.empik.test';
  const creds = { baseUrl: BASE, apiKey: 'key' };

  it('builds the OF01 line for the EAN', () => {
    expect(buildOfferCsv(draft, '11', 2)).toBe(
      '"sku";"product-id";"product-id-type";"price";"quantity";"state";"leadtime-to-ship";"update-delete"\n"LUO-1";"5901234567890";"EAN";"49.99";"7";"11";"2";"update"\n',
    );
  });

  it('checks the catalogue with P31, and treats an unreachable catalogue as unverified', async () => {
    server.use(
      http.get(`${BASE}/api/products`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('product_references')).toBe(`EAN|${draft.ean},EAN|222`);
        return HttpResponse.json({ products: [{ product_title: 'Cream', product_references: [{ reference_type: 'EAN', reference: draft.ean }] }] });
      }),
    );
    const found = await new EmpikAdapter(creds).checkCatalogue([draft.ean, '222']);
    expect(found.get(draft.ean)).toMatchObject({ found: true, name: 'Cream' });
    expect(found.get('222')).toEqual({ found: false });

    server.use(http.get(`${BASE}/api/products`, () => HttpResponse.json({ message: 'nope' }, { status: 404 })));
    expect((await new EmpikAdapter(creds).checkCatalogue([draft.ean])).get(draft.ean)).toEqual({ found: true, unverified: true });
  });

  it('imports the offer and waits for a clean verdict', async () => {
    let csv = '';
    let mode = '';
    server.use(
      http.post(`${BASE}/api/offers/imports`, async ({ request }) => {
        const form = await request.formData();
        csv = await (form.get('file') as File).text();
        mode = String(form.get('import_mode'));
        return HttpResponse.json({ import_id: 42 });
      }),
      http.get(`${BASE}/api/offers/imports/42`, () => HttpResponse.json({ status: 'COMPLETE', lines_in_error: 0, has_error_report: false })),
    );
    const result = await new EmpikAdapter(creds, { offerHandlingDays: 3, empikOfferState: '11' }).createOffer(draft);
    expect(result).toEqual({ externalId: 'LUO-1' });
    expect(mode).toBe('NORMAL');
    expect(csv).toContain('"LUO-1";"5901234567890";"EAN";"49.99";"7";"11";"3";"update"');
  });

  it('reports the import error line when Empik refuses the offer', async () => {
    server.use(
      http.post(`${BASE}/api/offers/imports`, () => HttpResponse.json({ import_id: 43 })),
      http.get(`${BASE}/api/offers/imports/43`, () => HttpResponse.json({ status: 'COMPLETE', lines_in_error: 1, has_error_report: true })),
      http.get(`${BASE}/api/offers/imports/43/error_report`, () => new HttpResponse('"sku";"error-message"\n"LUO-1";"Unknown product-id"\n')),
    );
    await expect(new EmpikAdapter(creds).createOffer(draft)).rejects.toThrow(/Empik refused the offer:.*Unknown product-id/);
  });

  it('says so when the import is still running', async () => {
    server.use(
      http.post(`${BASE}/api/offers/imports`, () => HttpResponse.json({ import_id: 44 })),
      http.get(`${BASE}/api/offers/imports/44`, () => HttpResponse.json({ status: 'RUNNING' })),
    );
    expect(await new EmpikAdapter(creds).createOffer(draft)).toEqual({ externalId: 'LUO-1', note: 'Empik is still processing import 44' });
  });
});
