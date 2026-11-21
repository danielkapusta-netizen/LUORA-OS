// Creating offers on Allegro and Empik from Shopify products: the requests we send and how refusals read.
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { markupPrice } from '@/lib/offers';
import { cleanShopifyTitle } from '@/lib/sku';
import { allegroHandlingTime, AllegroAdapter } from '@/server/integrations/marketplaces/allegro/adapter';
import type { AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';
import { EmpikAdapter } from '@/server/integrations/marketplaces/empik/adapter';
import { buildOfferCsv } from '@/server/integrations/marketplaces/mirakl/adapter';
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
  name: 'Luora Night Cream 50 ml',
  descriptionHtml: '<p>Rich <strong>night</strong> cream</p>',
  brand: 'Luora',
  imageUrls: ['https://img/1.jpg'],
  weightGrams: 120,
  quantity: 7,
  price: '49.99',
  currency: 'PLN',
};

describe('Shopify titles', () => {
  it('drops the default variant name', () => {
    expect(cleanShopifyTitle('Cream 50 ml - Default Title')).toBe('Cream 50 ml');
    expect(cleanShopifyTitle('MOEV Shampoo - Default')).toBe('MOEV Shampoo');
    expect(cleanShopifyTitle('Cream - Travel size')).toBe('Cream - Travel size');
  });
});

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
    allegroResponsibleProducerId: 'prod-resp-1',
    allegroResponsiblePersonId: 'pers-1',
    allegroLocation: { province: 'MAZOWIECKIE', city: 'Warszawa', postCode: '00-001' },
    offerHandlingDays: 2,
  };
  const UPLOAD = 'https://upload.allegro.pl.allegrosandbox.pl';
  let uploaded: string[] = [];
  beforeEach(() => {
    uploaded = [];
    server.use(
      http.post(`${UPLOAD}/sale/images`, async ({ request }) => {
        const { url } = (await request.json()) as { url: string };
        uploaded.push(url);
        if (url.includes('broken')) return HttpResponse.json({ errors: [{ userMessage: 'Nie udało się pobrać zdjęcia' }] }, { status: 422 });
        return HttpResponse.json({ location: `https://a.allegroimg.com/original/${url.split('/').pop()}`, expiresAt: '2026-12-01T00:00:00Z' }, { status: 201 });
      }),
    );
  });

  it('maps handling days onto the durations Allegro accepts', () => {
    expect([0, 1, 2, 3, 6, 100].map(allegroHandlingTime)).toEqual(['PT0S', 'PT24H', 'PT48H', 'P3D', 'P7D', 'P60D']);
  });

  it('lists what is still missing in the settings', () => {
    expect(new AllegroAdapter(creds(), {}).publishSetupProblems()).toHaveLength(6);
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
    expect(uploaded).toEqual(['https://img/1.jpg']);
    expect(body).toMatchObject({
      name: 'Luora Night Cream 50 ml',
      description: { sections: [{ items: [{ type: 'TEXT', content: '<p>Rich <b>night</b> cream</p>' }] }] },
      images: ['https://a.allegroimg.com/original/1.jpg'],
      productSet: [{ product: { id: 'prod-9' }, responsibleProducer: { type: 'ID', id: 'prod-resp-1' }, responsiblePerson: { id: 'pers-1' }, safetyInformation: { type: 'TEXT', description: expect.stringContaining('Produkt kosmetyczny') } }],
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

  it('uses the product’s own responsible person and producer, skips refused photos and shortens long titles', async () => {
    let body: { name?: string; images?: string[]; productSet?: { responsiblePerson: { id: string }; responsibleProducer: { id: string } }[] } = {};
    server.use(
      http.post(`${API}/sale/product-offers`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ id: 'offer-3' }, { status: 201 });
      }),
      http.get(`${API}/sale/product-offers/offer-3`, () => HttpResponse.json({ validation: { errors: [] }, publication: { status: 'ACTIVE' } })),
    );
    const long = { ...draft, name: 'Luora Regenerating Night Cream with Hyaluronic Acid and Ceramides for Dry Skin 50 ml', imageUrls: ['https://img/a.jpg', 'https://img/broken.jpg', 'https://img/b.jpg'], responsiblePersonId: 'pers-9', responsibleProducerId: 'prod-9' };
    const result = await new AllegroAdapter(creds(), settings).createOffer(long, { found: true, ref: 'prod-9' });
    expect(result.note).toContain('refused 1 photo');
    expect(body.images).toEqual(['https://a.allegroimg.com/original/a.jpg', 'https://a.allegroimg.com/original/b.jpg']);
    expect(body.name).toBe('Luora Regenerating Night Cream with Hyaluronic Acid and Ceramides for Dry');
    expect(body.productSet?.[0]).toMatchObject({ responsiblePerson: { id: 'pers-9' }, responsibleProducer: { id: 'prod-9' } });
  });

  it('refuses a title Allegro would not accept, before sending anything', async () => {
    await expect(new AllegroAdapter(creds(), settings).createOffer({ ...draft, name: 'Cream' }, { found: true, ref: 'p' })).rejects.toThrow('title too short');
    expect(uploaded).toEqual([]);
  });

  it('proposes a new product when the catalogue doesn’t know it', async () => {
    let body: { name?: string; parameters?: unknown; productSet?: { product: Record<string, unknown> }[] } = {};
    server.use(
      http.post(`${API}/sale/product-offers`, async ({ request }) => {
        body = (await request.json()) as typeof body;
        return HttpResponse.json({ id: 'offer-4' }, { status: 201 });
      }),
      http.get(`${API}/sale/product-offers/offer-4`, () => HttpResponse.json({ validation: { errors: [] }, publication: { status: 'INACTIVE' } })),
    );
    const allegroNewProduct = { categoryId: '257689', parameters: [{ id: '225693', values: [draft.ean] }], offerParameters: [{ id: '11323', valuesIds: ['11323_1'] }] };
    const result = await new AllegroAdapter(creds(), settings).createOffer({ ...draft, allegroNewProduct }, { found: false });
    expect(result.note).toContain('new product proposed');
    expect(body.productSet?.[0].product).toEqual({ name: 'Luora Night Cream 50 ml', category: { id: '257689' }, parameters: [{ id: '225693', values: [draft.ean] }], images: ['https://a.allegroimg.com/original/1.jpg'] });
    expect(body.parameters).toEqual([{ id: '11323', valuesIds: ['11323_1'] }]);
    await expect(new AllegroAdapter(creds(), settings).createOffer({ ...draft, imageUrls: [], allegroNewProduct }, { found: false })).rejects.toThrow('at least one photo');
  });

  it('reads category suggestions and parameters', async () => {
    server.use(
      http.get(`${API}/sale/matching-categories`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('name')).toBe('Krem do twarzy');
        return HttpResponse.json({ matchingCategories: [{ id: '257689', name: 'Kremy', parent: { id: '1', name: 'Uroda', parent: null } }] });
      }),
      http.get(`${API}/sale/categories/257689/parameters`, () =>
        HttpResponse.json({
          parameters: [
            { id: '248811', name: 'Marka', type: 'dictionary', required: true, requiredForProduct: true, unit: null, options: { describesProduct: true, ambiguousValueId: 'b9', customValuesEnabled: true }, dictionary: [{ id: 'b1', value: 'Luora', dependsOnValueIds: [] }], restrictions: { multipleChoices: false } },
            { id: '17448', name: 'Pojemność', type: 'float', required: true, requiredForProduct: true, unit: 'ml', options: { describesProduct: true }, restrictions: { min: 0.1, max: 5000, range: false, precision: 2 } },
          ],
        }),
      ),
    );
    const adapter = new AllegroAdapter(creds(), settings);
    expect(await adapter.suggestCategories('Krem do twarzy')).toEqual([{ id: '257689', path: 'Uroda > Kremy' }]);
    expect(await adapter.categoryParameters('257689')).toEqual([
      { id: '248811', name: 'Marka', type: 'dictionary', unit: null, required: true, requiredForProduct: true, describesProduct: true, dictionary: [{ id: 'b1', value: 'Luora' }], ambiguousValueId: 'b9', customValuesEnabled: true, multipleChoices: false, range: false },
      { id: '17448', name: 'Pojemność', type: 'float', unit: 'ml', required: true, requiredForProduct: true, describesProduct: true, ambiguousValueId: null, customValuesEnabled: false, multipleChoices: false, min: 0.1, max: 5000, range: false },
    ]);
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
      http.get(`${API}/sale/responsible-persons`, () => HttpResponse.json({ responsiblePersons: [{ id: 'pp1', name: 'Jan Kowalski' }] })),
      http.get(`${API}/sale/responsible-producers`, () => HttpResponse.json({ responsibleProducers: [{ id: 'rp1', name: 'Luora Sp. z o.o.' }, { id: 'rp2', producerData: { tradeName: 'Other Ltd' } }] })),
    );
    expect(await new AllegroAdapter(creds(), settings).publishOptions()).toEqual({
      shippingRates: [{ id: 's1', name: 'Standard' }],
      returnPolicies: [{ id: 'r1', name: '14 days' }],
      impliedWarranties: [{ id: 'i1', name: 'Reklamacje' }],
      warranties: [],
      responsibleProducers: [
        { id: 'rp1', name: 'Luora Sp. z o.o.' },
        { id: 'rp2', name: 'Other Ltd' },
      ],
      responsiblePersons: [{ id: 'pp1', name: 'Jan Kowalski' }],
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

  it('checks the catalogue with P31 and reads products by their product_id, as Mirakl returns them', async () => {
    const asked: string[] = [];
    server.use(
      http.get(`${BASE}/api/products`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('product_references')!;
        asked.push(q);
        // Mirakl names the matched reference product_id (+ product_id_type); it has no list called product_references.
        return HttpResponse.json({ products: q.includes(draft.ean) ? [{ product_id: draft.ean, product_id_type: 'EAN', product_sku: 'sku-1', product_title: 'Cream' }] : [] });
      }),
    );
    const found = await new EmpikAdapter(creds).checkCatalogue([draft.ean, '222']);
    expect(found.get(draft.ean)).toMatchObject({ found: true, name: 'Cream' });
    expect(found.get('222')).toEqual({ found: false });
    // One question for both, then the EAN the answer did not mention is asked about alone.
    expect(asked).toEqual([`EAN|${draft.ean},EAN|222`, 'EAN|222']);
  });

  it('still reads the older product_references shape', async () => {
    server.use(http.get(`${BASE}/api/products`, () => HttpResponse.json({ products: [{ product_title: 'Cream', product_references: [{ reference_type: 'EAN', reference: draft.ean }] }] })));
    expect((await new EmpikAdapter(creds).checkCatalogue([draft.ean])).get(draft.ean)).toMatchObject({ found: true, name: 'Cream' });
  });

  it('finds a product whatever shape the answer has, by asking about the EAN alone', async () => {
    // The batch answer names no EAN at all (an unknown shape); the single question returns just the product.
    server.use(
      http.get(`${BASE}/api/products`, ({ request }) => {
        const q = new URL(request.url).searchParams.get('product_references')!;
        return HttpResponse.json({ products: q.includes(',') ? [{ sku: 'x', title: 'Other' }] : q.includes(draft.ean) ? [{ sku: 'y', title: 'Cream 50ml' }] : [] });
      }),
    );
    const found = await new EmpikAdapter(creds).checkCatalogue([draft.ean, '222']);
    expect(found.get(draft.ean)).toMatchObject({ found: true, name: 'Cream 50ml' });
    expect(found.get('222')).toEqual({ found: false });
  });

  it('treats an unreachable catalogue as unverified, not as missing', async () => {
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
