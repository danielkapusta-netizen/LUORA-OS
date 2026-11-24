// DPD Polska web services: the SOAP we send and how DPD's answers read (parcels, labels, pickup call, protocol, tracking).
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DpdAdapter, dpdDeliveryStatus, DPD_CLASSIC, DPD_PICKUP } from '@/server/integrations/carriers/dpd/adapter';
import { envelope, text, toXml } from '@/server/integrations/carriers/dpd/soap';
import type { ShipmentRequest } from '@/server/integrations/carriers/types';

const URL_SERVICES = 'https://dpdservices.dpd.com.pl/DPDPackageObjServicesService/DPDPackageObjServices';
const URL_INFO = 'https://dpdinfoservices.dpd.com.pl/DPDInfoServicesObjEventsService/DPDInfoServicesObjEvents';
const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// Test credentials only: nothing here is a real DPD account.
const creds = { login: 'test-login', password: 'test-pass', masterFid: '1000', fid: '1001' };
const adapter = () => new DpdAdapter(creds);

const soap = (inner: string) =>
  `<?xml version="1.0"?><S:Envelope xmlns:S="http://schemas.xmlsoap.org/soap/envelope/"><S:Body><ns2:resp xmlns:ns2="http://dpdservices.dpd.com.pl/"><return>${inner}</return></ns2:resp></S:Body></S:Envelope>`;

/** Answers each operation from the map and keeps the request bodies. */
function dpd(answers: Record<string, string | ((body: string) => string)>, url = URL_SERVICES) {
  const seen: { op: string; body: string }[] = [];
  server.use(
    http.post(url, async ({ request }) => {
      const body = await request.text();
      const op = /<ns:(\w+)>/.exec(body)?.[1] ?? '?';
      seen.push({ op, body });
      const answer = answers[op];
      if (!answer) return new HttpResponse('<S:Envelope><S:Body><S:Fault><faultstring>unexpected</faultstring></S:Fault></S:Body></S:Envelope>', { status: 500 });
      return new HttpResponse(typeof answer === 'function' ? answer(body) : answer, { headers: { 'Content-Type': 'text/xml' } });
    }),
  );
  return seen;
}

const request: ShipmentRequest = {
  shipmentId: 'ship-1',
  service: DPD_PICKUP,
  sender: { name: 'Luora', company: 'Luora Sp. z o.o.', street: 'Prosta 1', city: 'Warszawa', postalCode: '00-850', countryCode: 'PL', phone: '+48 600 100 200', email: 'shop@example.com' },
  receiver: { name: 'Anna Nowak', street: 'Długa 5/2', city: 'Kraków', postalCode: '30-001', countryCode: 'PL', phone: '+48600700800', email: 'anna@example.com' },
  pickupPointId: 'pl19262',
  parcel: { lengthCm: 20, widthCm: 15, heightCm: 10, weightKg: 0.5 },
  codAmount: null,
  currency: 'PLN',
  reference: 'EMP-1001 · Cream & Serum',
  labelFormat: 'pdf',
};

describe('DPD SOAP helper', () => {
  it('builds unqualified children in key order and escapes text', () => {
    expect(toXml({ a: 'x & y', b: [{ c: 1 }, { c: 2 }], d: null, e: undefined, f: false })).toBe('<a>x &amp; y</a><b><c>1</c></b><b><c>2</c></b><f>false</f>');
    expect(envelope('http://ns/', 'op', { a: 1 })).toContain('<ns:op><a>1</a></ns:op>');
    expect(text('<x:Waybill>0000123&amp;U</x:Waybill>', 'Waybill')).toBe('0000123&U');
  });
});

describe('DPD parcels', () => {
  it('registers a DPD Pickup parcel from our FID and returns its waybill', async () => {
    const seen = dpd({
      generatePackagesNumbersV12: soap(
        '<Status>OK</Status><SessionId>1</SessionId><Packages><Package><Status>OK</Status><PackageId>55</PackageId><Parcels><Parcel><Status>OK</Status><ParcelId>66</ParcelId><Waybill>0000123456789U</Waybill></Parcel></Parcels></Package></Packages>',
      ),
    });
    const status = await adapter().createShipment(request);
    expect(status).toEqual({
      state: 'created',
      externalId: '0000123456789U',
      trackingNumber: '0000123456789U',
      trackingUrl: 'https://tracktrace.dpd.com.pl/parcelDetails?typ=1&p1=0000123456789U',
      carrierCode: 'DPD',
    });
    const body = seen[0].body;
    expect(body).toContain('<authDataV1><login>test-login</login><masterFid>1000</masterFid><password>test-pass</password></authDataV1>');
    expect(body).toContain('<services><dpdPickup><pudo>PL19262</pudo></dpdPickup></services>');
    expect(body).toContain('<payerType>SENDER</payerType>');
    expect(body).toMatch(/<sender>.*<fid>1001<\/fid>.*<postalCode>00850<\/postalCode><\/sender>/);
    expect(body).toMatch(/<receiver>.*<phone>600700800<\/phone><postalCode>30001<\/postalCode><\/receiver>/);
    expect(body).toContain('<weight>0.50</weight><sizeX>20</sizeX><sizeY>15</sizeY><sizeZ>10</sizeZ>');
    expect(body).toContain('<ref1>EMP-1001 · Cream &amp; Serum</ref1>');
    expect(body).not.toContain('<cod>');
  });

  it('sends cash on delivery and leaves the point out for the courier service', async () => {
    const seen = dpd({ generatePackagesNumbersV12: soap('<Status>OK</Status><Packages><Package><Status>OK</Status><Parcels><Parcel><Waybill>W1</Waybill></Parcel></Parcels></Package></Packages>') });
    await adapter().createShipment({ ...request, service: DPD_CLASSIC, codAmount: '89.9' });
    expect(seen[0].body).toContain('<services><cod><amount>89.90</amount><currency>PLN</currency></cod></services>');
  });

  it('explains what DPD refused, and checks the point and contact before asking', async () => {
    dpd({
      generatePackagesNumbersV12: soap(
        '<Status>INCORRECT_DATA</Status><Packages><Package><Status>INCORRECT_DATA</Status><ValidationDetails><ValidationInfo><ErrorId>1</ErrorId><ErrorCode>RECEIVER_PHONE</ErrorCode><FieldNames>RECEIVER_PHONE</FieldNames><Info>Niepoprawny numer telefonu</Info></ValidationInfo></ValidationDetails></Package></Packages>',
      ),
    });
    expect(await adapter().createShipment(request)).toMatchObject({ state: 'failed', error: 'DPD refused the parcel (INCORRECT_DATA): RECEIVER_PHONE: Niepoprawny numer telefonu' });
    expect(await adapter().createShipment({ ...request, pickupPointId: null })).toMatchObject({ state: 'failed', error: expect.stringContaining('point code') });
    expect(await adapter().createShipment({ ...request, receiver: { ...request.receiver, email: null } })).toMatchObject({ state: 'failed', error: expect.stringContaining('phone and e-mail') });
  });

  it('never repeats the create call, which would register a second parcel', async () => {
    let posts = 0;
    server.use(
      http.post(URL_SERVICES, () => {
        posts++;
        return new HttpResponse('busy', { status: 503 });
      }),
    );
    await expect(adapter().createShipment(request)).rejects.toThrow('HTTP 503');
    expect(posts).toBe(1);
  });

  it('turns a SOAP fault into a readable error', async () => {
    server.use(http.post(URL_SERVICES, () => new HttpResponse('<S:Envelope><S:Body><S:Fault><faultcode>S:Server</faultcode><faultstring>Login failed</faultstring></S:Fault></S:Body></S:Envelope>', { status: 500 })));
    await expect(adapter().getLabels(['W1'], { format: 'pdf', size: 'A6' })).rejects.toThrow('DPD generateSpedLabelsV4: Login failed');
  });
});

describe('DPD documents', () => {
  it('prints labels for a label printer and decodes the PDF', async () => {
    const seen = dpd({ generateSpedLabelsV4: soap(`<documentData>${Buffer.from('%PDF-1.4 label').toString('base64')}</documentData><session><statusInfo><status>OK</status></statusInfo></session>`) });
    const pdf = await adapter().getLabels(['W1', 'W2'], { format: 'pdf', size: 'A6' });
    expect(pdf.toString()).toBe('%PDF-1.4 label');
    expect(seen[0].body).toContain('<session><packages><parcels><waybill>W1</waybill></parcels><parcels><waybill>W2</waybill></parcels></packages><sessionType>DOMESTIC</sessionType></session>');
    expect(seen[0].body).toContain('<outputDocFormatV1>PDF</outputDocFormatV1><outputDocPageFormatV1>LBL_PRINTER</outputDocPageFormatV1><outputLabelType>BIC3</outputLabelType>');
  });

  it('says why there is no label', async () => {
    dpd({ generateSpedLabelsV4: soap('<session><statusInfo><status>NOT_FOUND</status><description>Waybill not found</description></statusInfo></session>') });
    await expect(adapter().getLabels(['W9'], { format: 'zpl', size: 'A4' })).rejects.toThrow('DPD gave no label: NOT_FOUND Waybill not found');
  });

  it('prints the handover protocol from our FID', async () => {
    const seen = dpd({ generateProtocolV2: soap(`<documentData>${Buffer.from('%PDF protocol').toString('base64')}</documentData>`) });
    expect((await adapter().protocol(['W1'])).toString()).toBe('%PDF protocol');
    expect(seen[0].body).toContain('<pickupAddress><fid>1001</fid></pickupAddress>');
  });
});

describe('DPD courier pickup', () => {
  const at = { name: 'Jan Kowalski', company: 'Luora', street: 'Prosta 1', postalCode: '00-850', city: 'Warszawa', countryCode: 'PL', phone: '+48600100200', email: 'shop@example.com' };

  it('offers the windows DPD gives for our postcode on the next working days', async () => {
    const seen = dpd({ getCourierOrderAvailabilityV1: soap('<ranges><offset>0</offset><range>10:00-13:00</range></ranges><ranges><offset>0</offset><range>13:00-16:00</range></ranges><status>OK</status>') });
    const slots = await adapter().pickupProposals(['W1', 'W2'], at);
    expect(seen[0].body).toContain('<senderPlaceV1><countryCode>PL</countryCode><zipCode>00850</zipCode></senderPlaceV1>');
    const w1 = slots.get('W1')!;
    expect(w1.length).toBe(6);
    expect(w1[0]).toMatchObject({ minTime: '10:00', maxTime: '13:00' });
    expect(slots.get('W2')).toEqual(w1);
  });

  it('orders the courier, paid by our FID, and is booked at once', async () => {
    const seen = dpd({ packagesPickupCallV4: soap('<checkSum>1</checkSum><orderNumber>DPD-ORDER-7</orderNumber><statusInfo><status>OK</status></statusInfo>') });
    const status = await adapter().createPickup('cmd', ['W1', 'W2', 'W3'], { date: '2026-11-24', minTime: '10:00', maxTime: '13:00' }, at);
    expect(status).toEqual({ state: 'booked', pickupId: 'DPD-ORDER-7', carrierPickupId: 'DPD-ORDER-7' });
    const body = seen[0].body;
    expect(body).toContain('<operationType>INSERT</operationType><orderType>DOMESTIC</orderType>');
    expect(body).toContain('<parcelsCount>3</parcelsCount>');
    expect(body).toContain('<pickupPayer><payerName>Luora</payerName><payerNumber>1001</payerNumber></pickupPayer>');
    expect(body).toContain('<pickupDate>2026-11-24</pickupDate><pickupTimeFrom>10:00</pickupTimeFrom><pickupTimeTo>13:00</pickupTimeTo><waybillsReady>true</waybillsReady>');
    expect(body).toContain('<senderPostalCode>00850</senderPostalCode>');
    // DPD's own validator refuses UpdateMode on a new order ("Incorrect DPDPickupCallParams format").
    expect(body).not.toContain('updateMode');
  });

  it('reports a refused pickup', async () => {
    dpd({ packagesPickupCallV4: soap('<statusInfo><status>ERROR</status><errorDetails><code>E1</code><description>Brak dostępnych terminów</description><fields>pickupDate</fields></errorDetails></statusInfo>') });
    expect(await adapter().createPickup('cmd', ['W1'], { date: '2026-11-24' }, at)).toEqual({ state: 'failed', error: 'DPD refused the pickup (ERROR): pickupDate: Brak dostępnych terminów' });
  });
});

describe('DPD tracking and connection', () => {
  it('reads the last event through DPDInfoServices with the FID as channel', async () => {
    const seen = dpd(
      { getEventsForWaybillV1: soap('<eventsList><businessCode>190101</businessCode><description>Przesyłka doręczona</description><waybill>W1</waybill></eventsList>') },
      URL_INFO,
    );
    expect(await adapter().deliveryStatus({ trackingNumber: 'W1' })).toBe('delivered');
    expect(seen[0].body).toContain('<authDataV1><channel>1001</channel><login>test-login</login><password>test-pass</password></authDataV1>');
  });

  it('maps DPD event descriptions', () => {
    expect(dpdDeliveryStatus('Przesyłka odebrana przez Kuriera')).toBe('in_transit');
    expect(dpdDeliveryStatus('Przesyłka gotowa do odbioru w punkcie DPD Pickup')).toBe('ready_for_pickup');
    expect(dpdDeliveryStatus('Przesyłka odebrana w punkcie')).toBe('delivered');
    expect(dpdDeliveryStatus('Zwrot do nadawcy')).toBe('returned');
    expect(dpdDeliveryStatus('')).toBe('unknown');
  });

  it('checks the login without creating anything', async () => {
    const seen = dpd({ findPostalCodeV1: soap('<status>OK</status>') });
    expect(await adapter().checkConnection()).toBe('DPD: FID 1001');
    expect(seen.map((s) => s.op)).toEqual(['findPostalCodeV1']);
  });
});
