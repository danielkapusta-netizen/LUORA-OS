import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { declaredValue, deliveryMethodOf, isInsuranceRequiredError, isPacketaMethod } from '@/server/integrations/carriers/allegro-shipping/insurance';
import { allegroPhone, allegroReferenceNumber, AllegroShippingAdapter, buildCreateCommand } from '@/server/integrations/carriers/allegro-shipping/adapter';
import { buildShipxPayload, InpostAdapter, sendingMethodFor } from '@/server/integrations/carriers/inpost/adapter';
import type { ShipmentRequest } from '@/server/integrations/carriers/types';
import { AllegroClient, type AllegroCredentials } from '@/server/integrations/marketplaces/allegro/client';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const request: ShipmentRequest = {
  shipmentId: '5b0c4f8e-7d4a-4b8a-9f5e-2f1c7a6d9e10',
  service: 'inpost_locker_standard',
  sender: { name: 'Magazyn', company: 'Luora', street: 'ul. Magazynowa 5', city: 'Warszawa', postalCode: '02-222', countryCode: 'PL', phone: '+48 500 600 700', email: 'w@example.com' },
  receiver: { name: 'Jan Kowalski', street: 'ul. Długa 5/3', city: 'Kraków', postalCode: '31-147', countryCode: 'PL', phone: '+48 600 700 800', email: 'jan@example.com' },
  pickupPointId: 'KRA010',
  parcel: { lengthCm: 30, widthCm: 20, heightCm: 10, weightKg: 1.5, inpostTemplate: 'medium' },
  codAmount: null,
  insuranceAmount: null,
  currency: 'PLN',
  reference: '#1042',
  deliveryMethodId: '2488f7b7-5d1c-4d65-b85c-4cbcf253fd93',
  labelFormat: 'pdf',
};

describe('InPost ShipX', () => {
  const SHIPX = 'https://sandbox-api-shipx-pl.easypack24.net';
  const adapter = new InpostAdapter({ apiToken: 'tok', organizationId: '42', sandbox: true });

  it('builds a locker payload with a template and target point', () => {
    const p = buildShipxPayload(request, {});
    expect(p.parcels).toEqual([{ template: 'medium' }]);
    expect(p.custom_attributes).toEqual({ target_point: 'KRA010', sending_method: 'dispatch_order' });
    expect(p.receiver).toMatchObject({ first_name: 'Jan', last_name: 'Kowalski', phone: '600700800', address: undefined });
    expect(p.sender.address).toEqual({ street: 'ul. Magazynowa', building_number: '5', city: 'Warszawa', post_code: '02-222', country_code: 'PL' });
  });

  it('builds a courier payload in millimetres, with insurance covering COD', () => {
    const p = buildShipxPayload({ ...request, service: 'inpost_courier_standard', codAmount: '199.90', pickupPointId: null }, { sendingMethod: 'parcel_locker' });
    expect(p.parcels).toEqual([{ dimensions: { length: '300', width: '200', height: '100', unit: 'mm' }, weight: { amount: '1.5', unit: 'kg' } }]);
    expect(p.receiver.address).toMatchObject({ street: 'ul. Długa', building_number: '5/3' });
    expect(p.cod).toEqual({ amount: 199.9, currency: 'PLN' });
    expect(p.insurance).toEqual({ amount: 199.9, currency: 'PLN' });
    // ShipX rejects parcel_locker for courier services ("unavailable_for_service").
    expect(p.custom_attributes).toEqual({ sending_method: 'dispatch_order' });
  });

  it('sends a one-word recipient name as both first and last name (ShipX requires last_name)', () => {
    const p = buildShipxPayload({ ...request, receiver: { ...request.receiver, name: 'Kowalski' } }, {});
    expect(p.receiver).toMatchObject({ first_name: 'Kowalski', last_name: 'Kowalski' });
  });

  it('drops only locker parcels at the Paczkomat; courier parcels are picked up', () => {
    const settings = { sendingMethod: 'parcel_locker', dropoffPoint: 'ZOF01M' };
    expect(sendingMethodFor('inpost_locker_standard', settings)).toBe('parcel_locker');
    expect(sendingMethodFor('inpost_courier_standard', settings)).toBe('dispatch_order');
    expect(sendingMethodFor('inpost_courier_standard', { sendingMethod: 'pop' })).toBe('pop');
  });

  it('sends the drop-off Paczkomat when parcels are dropped at a locker', () => {
    const p = buildShipxPayload(request, { sendingMethod: 'parcel_locker', dropoffPoint: 'ZOF01M' });
    expect(p.custom_attributes).toEqual({ target_point: 'KRA010', sending_method: 'parcel_locker', dropoff_point: 'ZOF01M' });
    expect(buildShipxPayload(request, { sendingMethod: 'dispatch_order', dropoffPoint: 'ZOF01M' }).custom_attributes.dropoff_point).toBeUndefined();
  });

  it('refuses to drop at a locker without a drop-off point, before calling InPost', async () => {
    const locker = new InpostAdapter({ apiToken: 'tok', organizationId: '42', sandbox: true }, { sendingMethod: 'parcel_locker' });
    const status = await locker.createShipment(request);
    expect(status).toMatchObject({ state: 'failed', error: expect.stringContaining('Drop-off point') });
  });

  it('refuses a locker label without a pickup point before calling InPost', async () => {
    const status = await adapter.createShipment({ ...request, pickupPointId: null });
    expect(status.state).toBe('failed');
  });

  it('creates, polls until confirmed, and downloads the label', async () => {
    let posts = 0;
    let polls = 0;
    server.use(
      http.post(`${SHIPX}/v1/organizations/42/shipments`, ({ request: req }) => {
        posts++;
        expect(req.headers.get('authorization')).toBe('Bearer tok');
        return HttpResponse.json({ id: 9001, status: 'created', tracking_number: null }, { status: 201 });
      }),
      http.get(`${SHIPX}/v1/shipments/9001`, () => {
        polls++;
        return HttpResponse.json(polls < 2 ? { id: 9001, status: 'created', tracking_number: null } : { id: 9001, status: 'confirmed', tracking_number: '620111222333444555666777' });
      }),
      http.get(`${SHIPX}/v1/shipments/9001/label`, ({ request: req }) => {
        const url = new URL(req.url);
        expect(url.searchParams.get('format')).toBe('Pdf');
        expect(url.searchParams.get('type')).toBe('A6');
        return new HttpResponse('%PDF-1.4', { headers: { 'Content-Type': 'application/pdf' } });
      }),
    );
    const created = await adapter.createShipment(request);
    expect(created).toMatchObject({ state: 'pending', externalId: '9001' });
    expect((await adapter.refreshShipment({ externalId: '9001' })).state).toBe('pending');
    const done = await adapter.refreshShipment({ externalId: '9001' });
    expect(done).toMatchObject({ state: 'created', trackingNumber: '620111222333444555666777', carrierCode: 'INPOST' });
    expect(done.trackingUrl).toContain('620111222333444555666777');
    expect((await adapter.getLabels(['9001'], { format: 'pdf', size: 'A6' })).toString()).toBe('%PDF-1.4');
    expect(posts).toBe(1);
  });

  it('does not retry a failed create (a retry could buy a second label)', async () => {
    let posts = 0;
    server.use(
      http.post(`${SHIPX}/v1/organizations/42/shipments`, () => {
        posts++;
        return new HttpResponse(null, { status: 502 });
      }),
    );
    await expect(adapter.createShipment(request)).rejects.toThrow(/502/);
    expect(posts).toBe(1);
  });

  it('maps tracking statuses', async () => {
    server.use(http.get(`${SHIPX}/v1/tracking/:n`, () => HttpResponse.json({ status: 'delivered' })));
    expect(await adapter.deliveryStatus({ trackingNumber: '1' })).toBe('delivered');
  });
});

describe('Allegro Delivery (Wysyłam z Allegro)', () => {
  const API = 'https://api.allegro.pl.allegrosandbox.pl';
  const creds: AllegroCredentials = { clientId: 'c', clientSecret: 's', sandbox: true, accessToken: 'a', refreshToken: 'r', expiresAt: new Date(Date.now() + 3600_000).toISOString() };
  const adapter = new AllegroShippingAdapter(new AllegroClient({ get: () => creds, save: async () => {} }), { codIban: 'PL61109010140000071219812874', codOwnerName: 'Luora' });

  const services = (forceRequireIban: boolean) =>
    http.get(`${API}/shipment-management/delivery-services`, () =>
      HttpResponse.json({
        services: [
          {
            id: { deliveryMethodId: '2488f7b7-5d1c-4d65-b85c-4cbcf253fd93' },
            name: 'Allegro Paczkomaty InPost pobranie',
            cashOnDelivery: { limit: 5000, currency: 'PLN', paymentType: 'MONEY_TRANSFER', forceRequireIban },
          },
        ],
      }),
    );

  it('uses the buyer’s delivery method and our shipment id as the command id', () => {
    const cmd = buildCreateCommand({ ...request, service: 'buyer_choice' }, {}, request.shipmentId);
    expect(cmd.commandId).toBe(request.shipmentId);
    expect(cmd.input.deliveryMethodId).toBe('2488f7b7-5d1c-4d65-b85c-4cbcf253fd93');
    expect(cmd.input.receiver.point).toBe('KRA010');
    expect(cmd.input.packages[0]).toMatchObject({ type: 'PACKAGE', length: { value: 30, unit: 'CENTIMETER' }, weight: { value: 1.5, unit: 'KILOGRAMS' } });
  });

  it('keeps the reference number to the characters Allegro accepts (letters, digits, _/-)', () => {
    const reference = '6B7C4270: 2x Anua PDRN 100 + Hyaluron, 1x Żel łagodzący 50%';
    expect(allegroReferenceNumber(reference)).toBe('6B7C4270_2x_Anua_PDRN_100_Hyaluron');
    expect(allegroReferenceNumber('C53975A1: 1x Abib Glutathione Kojic Acid Eye Patch').length).toBeLessThanOrEqual(35);
    expect(allegroReferenceNumber('AB: 1x Ż')).toBe('AB_1x_Z');
    const cmd = buildCreateCommand({ ...request, service: 'buyer_choice', reference }, {}, request.shipmentId);
    expect(cmd.input.referenceNumber).toMatch(/^[A-Za-z0-9_/-]+$/);
    expect(cmd.input.packages[0].textOnLabel).toBe('6B7C4270: 2x Anua PDRN 100 + H');
    expect(cmd.input.packages[0].textOnLabel.length).toBeLessThanOrEqual(30);
  });

  it('normalises phone numbers, keeping a foreign prefix (Hungary)', () => {
    const hu = { ...request.receiver, countryCode: 'hu', postalCode: ' 1051 ', phone: '+36 30 123 4567' };
    const cmd = buildCreateCommand({ ...request, service: 'buyer_choice', receiver: hu }, {}, request.shipmentId);
    expect(cmd.input.receiver).toMatchObject({ phone: '+36301234567', countryCode: 'HU', postalCode: '1051' });
    expect(cmd.input.sender.phone).toBe('+48500600700');
    expect(allegroPhone('0036 30 123 4567')).toBe('+36301234567');
    expect(allegroPhone('600-700-800')).toBe('600700800');
    expect(allegroPhone('600 700 800', 'PL')).toBe('+48600700800');
    expect(allegroPhone('48600700800', 'PL')).toBe('+48600700800');
    expect(allegroPhone('+36 30 123 4567', 'PL')).toBe('+36301234567');
    expect(allegroPhone('0301234567', 'HU')).toBe('+36301234567');
  });

  it('sends COD without an IBAN when the money goes to the Allegro balance', async () => {
    let body: { input: { cashOnDelivery?: Record<string, unknown> } } | undefined;
    server.use(
      services(false),
      http.post(`${API}/shipment-management/shipments/create-commands`, async ({ request: req }) => {
        body = (await req.json()) as typeof body;
        return HttpResponse.json(body, { status: 201 });
      }),
    );
    const noIban = new AllegroShippingAdapter(new AllegroClient({ get: () => creds, save: async () => {} }), {});
    expect((await noIban.createShipment({ ...request, service: 'buyer_choice', codAmount: '99.90' })).state).toBe('pending');
    expect(body?.input.cashOnDelivery).toEqual({ amount: '99.90', currency: 'PLN' });
  });

  it('adds the IBAN only when the delivery service requires it', async () => {
    let body: { input: { cashOnDelivery?: Record<string, unknown> } } | undefined;
    server.use(
      services(true),
      http.post(`${API}/shipment-management/shipments/create-commands`, async ({ request: req }) => {
        body = (await req.json()) as typeof body;
        return HttpResponse.json(body, { status: 201 });
      }),
    );
    await adapter.createShipment({ ...request, service: 'buyer_choice', codAmount: '50.00' });
    expect(body?.input.cashOnDelivery).toEqual({ amount: '50.00', currency: 'PLN', ownerName: 'Luora', iban: 'PL61109010140000071219812874' });

    const noIban = new AllegroShippingAdapter(new AllegroClient({ get: () => creds, save: async () => {} }), {});
    const failed = await noIban.createShipment({ ...request, service: 'buyer_choice', codAmount: '10.00' });
    expect(failed.state).toBe('failed');
    expect(failed.error).toMatch(/IBAN/);
  });

  it('turns an Allegro validation error into a readable message', async () => {
    server.use(
      http.post(`${API}/shipment-management/shipments/create-commands`, () =>
        HttpResponse.json(
          { errors: [{ code: 'VALIDATION_ERROR', message: 'Niepoprawny numer telefonu', path: 'receiver.phone', userMessage: null }] },
          { status: 422 },
        ),
      ),
    );
    await expect(adapter.createShipment({ ...request, service: 'buyer_choice' })).rejects.toThrow(
      'Allegro (HTTP 422): receiver.phone: Niepoprawny numer telefonu',
    );
  });

  it('creates asynchronously, then reads the waybill', async () => {
    let commandPolls = 0;
    server.use(
      http.post(`${API}/shipment-management/shipments/create-commands`, async ({ request: req }) => {
        const body = (await req.json()) as { commandId: string };
        expect(body.commandId).toBe(request.shipmentId);
        return HttpResponse.json(body, { status: 201, headers: { 'Retry-After': '2' } });
      }),
      http.get(`${API}/shipment-management/shipments/create-commands/:id`, ({ params }) => {
        commandPolls++;
        return HttpResponse.json(
          commandPolls < 2 ? { commandId: params.id, status: 'IN_PROGRESS', errors: [] } : { commandId: params.id, status: 'SUCCESS', errors: [], shipmentId: 'shp-1' },
          { headers: { 'Retry-After': '1' } },
        );
      }),
      http.get(`${API}/shipment-management/shipments/shp-1`, () =>
        HttpResponse.json({ id: 'shp-1', carrier: 'INPOST', packages: [{ waybill: '6209999', transportingInfo: [{ carrierId: 'INPOST', carrierWaybill: '6209999' }] }] }),
      ),
    );
    const created = await adapter.createShipment({ ...request, service: 'buyer_choice' });
    expect(created).toMatchObject({ state: 'pending', commandId: request.shipmentId, retryAfterSeconds: 2 });
    expect(await adapter.refreshShipment({ externalId: null, commandId: request.shipmentId })).toMatchObject({ state: 'pending', retryAfterSeconds: 1 });
    expect(await adapter.refreshShipment({ externalId: null, commandId: request.shipmentId })).toMatchObject({
      state: 'created',
      externalId: 'shp-1',
      trackingNumber: '6209999',
      carrierCode: 'INPOST',
    });
  });

  it('keeps the carrier’s reason when Allegro gives only a generic message', async () => {
    server.use(
      http.get(`${API}/shipment-management/shipments/create-commands/:id`, ({ params }) =>
        HttpResponse.json({
          commandId: params.id,
          status: 'ERROR',
          errors: [{ code: 'CARRIER_ERROR', userMessage: 'Błąd zewnętrznego przewoźnika', message: 'Błąd zewnętrznego przewoźnika', details: 'Invalid receiver phone number', path: null }],
        }),
      ),
    );
    expect(await adapter.refreshShipment({ externalId: null, commandId: 'c2' })).toMatchObject({
      state: 'failed',
      error: 'Błąd zewnętrznego przewoźnika (Invalid receiver phone number)',
    });
  });

  it('reports command errors', async () => {
    server.use(
      http.get(`${API}/shipment-management/shipments/create-commands/:id`, ({ params }) =>
        HttpResponse.json({ commandId: params.id, status: 'ERROR', errors: [{ code: 'X', message: 'Kod pocztowy odbiorcy jest niedostępny', path: 'receiver.postalCode', userMessage: null }] }),
      ),
    );
    expect(await adapter.refreshShipment({ externalId: null, commandId: 'c1' })).toMatchObject({
      state: 'failed',
      error: 'receiver.postalCode: Kod pocztowy odbiorcy jest niedostępny',
    });
  });
});

describe('Allegro Delivery insurance', () => {
  it('recognises the Packeta / ORLEN Paczka methods and the insurance-required error', () => {
    expect(isPacketaMethod('Allegro Wysyłka z Polski do Słowacji - Odbiór w Punkcie Packeta pobranie, ORLEN Paczka')).toBe(true);
    expect(isPacketaMethod('Allegro Wysyłka z Polski do Czech - Automaty Paczkowe Packeta, ORLEN Paczka')).toBe(true);
    expect(isPacketaMethod('Allegro International Automaty Paczkowe Czechy, InPost')).toBe(false);
    expect(isPacketaMethod(null)).toBe(false);
    expect(isInsuranceRequiredError('insurance: Ubezpieczenie jest wymagane w celu utworzenia przesyłki (Insurance is required to create a parcel)')).toBe(true);
    expect(isInsuranceRequiredError('receiver.street: Długość podanego tekstu przekracza 35 znaków')).toBe(false);
  });

  it('insures for what the buyer paid, in the order currency', () => {
    expect(declaredValue({ totalAmount: '19.6' })).toBe('19.60');
    expect(deliveryMethodOf('buyer_choice', { deliveryMethodId: 'dm-1' })).toBe('dm-1');
    expect(deliveryMethodOf('dm-2', { deliveryMethodId: 'dm-1' })).toBe('dm-2');
  });

  it('puts the insurance in the create command', () => {
    const cmd = buildCreateCommand({ ...request, service: 'buyer_choice', insuranceAmount: '19.60', currency: 'EUR' }, {}, request.shipmentId);
    expect(cmd.input.insurance).toEqual({ amount: '19.60', currency: 'EUR' });
    expect(buildCreateCommand({ ...request, service: 'buyer_choice', insuranceAmount: null }, {}, request.shipmentId).input.insurance).toBeUndefined();
  });
});

