import { createHmac } from 'node:crypto';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ifirmaAuthHeader, IfirmaClient } from '@/server/integrations/accounting/ifirma/client';
import { buildDomesticPayload, buildOssPayload, planInvoice, type InvoiceOrder } from '@/server/integrations/accounting/ifirma/mapper';
import { nbpRateBefore } from '@/server/integrations/accounting/nbp';
import type { InvoiceRequest } from '@/server/integrations/types';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const API = 'https://www.ifirma.pl/iapi';
const KEY = 'EAB0D8ACF3308F3B';
const client = new IfirmaClient({ login: 'luora', invoiceKey: KEY });

const company: InvoiceRequest = { name: 'Kosmetyki Sp. z o.o.', taxId: '5250001009', euPrefix: null, street: 'Prosta 1', postalCode: '00-001', city: 'Warszawa', countryCode: 'PL', email: 'a@b.pl' };
const person: InvoiceRequest = { name: 'Jana Nováková', taxId: null, euPrefix: null, street: 'Na Svahu 277', postalCode: '381 01', city: 'Český Krumlov', countryCode: 'CZ' };

const order = (o: Partial<InvoiceOrder> = {}): InvoiceOrder => ({
  marketplace: 'allegro',
  externalNumber: '6B7C4270',
  shippingAddress: { name: 'X', street: 'Prosta 1', city: 'Warszawa', postalCode: '00-001', countryCode: 'PL' },
  currency: 'PLN',
  totalAmount: '129.80',
  shippingAmount: '9.90',
  codAmount: null,
  ...o,
});
const items = [{ name: 'Anua Heartleaf Toner 250 ml', quantity: 2, unitPrice: '59.95' }];
const ctx = { issueDate: '2026-10-02', saleDate: '2026-10-01', settings: { placeOfIssue: 'Warszawa' }, vatRate: 0.23 };

describe('ifirma signing', () => {
  it('signs url without query + login + key name + body with the hex key bytes', () => {
    const body = '{"a":1}';
    const expected = createHmac('sha1', Buffer.from(KEY, 'hex')).update(`${API}/faktury.json` + 'luora' + 'faktura' + body).digest('hex');
    expect(ifirmaAuthHeader(`${API}/faktury.json?dataOd=2026-10-01`, 'luora', KEY, body)).toBe(`IAPIS user=luora, hmac-sha1=${expected}`);
  });
});

describe('IfirmaClient', () => {
  it('issues a domestic invoice and returns its id, sending the signed header', async () => {
    let seen: { auth: string | null; body: unknown } | null = null;
    server.use(
      http.post(`${API}/fakturakraj.json`, async ({ request }) => {
        seen = { auth: request.headers.get('authentication'), body: await request.json() };
        return HttpResponse.json({ response: { Kod: 0, Informacja: 'Faktura została pomyślnie dodana.', Identyfikator: '1244512' } });
      }),
    );
    expect(await client.create('domestic', { Pozycje: [] })).toEqual({ externalId: '1244512' });
    expect(seen!.auth).toBe(ifirmaAuthHeader(`${API}/fakturakraj.json`, 'luora', KEY, JSON.stringify({ Pozycje: [] })));
    expect(seen!.body).toEqual({ Pozycje: [] });
  });

  it('turns a non-zero "Kod" into a readable error, and never retries a POST', async () => {
    let posts = 0;
    server.use(
      http.post(`${API}/fakturaoss.json`, () => {
        posts++;
        return HttpResponse.json({ response: { Kod: 201, Informacja: 'Nieprawidłowa data sprzedaży' } });
      }),
    );
    await expect(client.create('oss', {})).rejects.toThrow('ifirma (kod 201): Nieprawidłowa data sprzedaży');
    expect(posts).toBe(1);
  });

  it('downloads the PDF, and reports JSON errors returned instead of a PDF', async () => {
    server.use(http.get(`${API}/fakturakraj/77.pdf`, () => new HttpResponse('%PDF-1.4 x', { headers: { 'Content-Type': 'application/pdf' } })));
    expect((await client.getPdf('domestic', '77')).toString()).toBe('%PDF-1.4 x');
    server.use(http.get(`${API}/fakturakraj/78.pdf`, () => HttpResponse.json({ response: { Kod: 400, Informacja: 'Brak faktury' } })));
    await expect(client.getPdf('domestic', '78')).rejects.toThrow('Brak faktury');
  });

  it('finds the full number and KSeF status in the invoice list', async () => {
    server.use(
      http.get(`${API}/faktury.json`, ({ request }) => {
        expect(new URL(request.url).searchParams.get('dataOd')).toBe('2026-10-02');
        return HttpResponse.json({ response: { Kod: 0, Wynik: [{ FakturaId: 1244512, PelnyNumer: '12/10/2026', KsefStatus: 'PRZYJETA' }] } });
      }),
    );
    expect(await client.getDetails('1244512', '2026-10-02')).toEqual({ number: '12/10/2026', ksefStatus: 'PRZYJETA' });
  });

  it('reads the standard VAT rate of an EU country', async () => {
    server.use(
      http.get(`${API}/slownik/stawki_vat/CZ.json`, () =>
        HttpResponse.json({ response: { Kod: 0, KodKraju: 'cz', StawkiVat: [{ Rodzaj: 'POD', Wartosc: 21.0 }, { Rodzaj: 'PR1', Wartosc: 12.0 }] } }),
      ),
    );
    expect(await client.standardVatRate('CZ')).toBe(0.21);
  });

  it('sends an invoice to KSeF', async () => {
    let body: unknown;
    server.use(
      http.post(`${API}/fakturakraj/ksef/send/1244512.json`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ response: { Kod: 0 } });
      }),
    );
    await client.sendToKsef('domestic', '1244512');
    expect(body).toEqual({ DataWysylki: null });
  });
});

describe('planInvoice', () => {
  it('picks domestic for Poland and OSS for a private buyer elsewhere in the EU', () => {
    expect(planInvoice(order(), items, company)).toEqual({ kind: 'domestic' });
    const cz = order({ currency: 'CZK', totalAmount: '630.00', shippingAmount: '0', shippingAddress: { ...order().shippingAddress, countryCode: 'CZ' } });
    expect(planInvoice(cz, [{ name: 'Krem', quantity: 2, unitPrice: '315.00' }], person)).toEqual({ kind: 'oss' });
  });

  it('leaves foreign companies, non-EU buyers and totals that do not add up to a person', () => {
    const cz = order({ shippingAddress: { ...order().shippingAddress, countryCode: 'CZ' } });
    expect(planInvoice(cz, items, { ...company, euPrefix: 'CZ', countryCode: 'CZ' })).toMatchObject({ kind: 'manual', reason: expect.stringContaining('WDT') });
    expect(planInvoice(order({ shippingAddress: { ...order().shippingAddress, countryCode: 'UA' } }), items, person)).toMatchObject({ kind: 'manual' });
    expect(planInvoice(order({ totalAmount: '119.80' }), items, company)).toMatchObject({ kind: 'manual', reason: expect.stringContaining('discount') });
  });
});

describe('ifirma payloads', () => {
  it('builds a paid domestic invoice for a company, with a shipping line', () => {
    const p = buildDomesticPayload(order(), items, company, ctx);
    expect(p).toMatchObject({ LiczOd: 'BRT', SposobZaplaty: 'ELE', Zaplacono: 129.8, DataSprzedazy: '2026-10-01', DataWystawienia: '2026-10-02', MiejsceWystawienia: 'Warszawa', Uwagi: 'Zamówienie Allegro 6B7C4270' });
    expect(p.Pozycje).toEqual([
      { NazwaPelna: 'Anua Heartleaf Toner 250 ml', Ilosc: 2, CenaJednostkowa: 59.95, Jednostka: 'szt.', StawkaVat: 0.23, TypStawkiVat: 'PRC' },
      { NazwaPelna: 'Dostawa', Ilosc: 1, CenaJednostkowa: 9.9, Jednostka: 'szt.', StawkaVat: 0.23, TypStawkiVat: 'PRC' },
    ]);
    expect(p.Kontrahent).toMatchObject({ Nazwa: 'Kosmetyki Sp. z o.o.', NIP: '5250001009', OsobaFizyczna: false, KodKraju: 'PL' });
  });

  it('marks cash on delivery as unpaid, payable on delivery', () => {
    const p = buildDomesticPayload(order({ codAmount: '129.80' }), items, { ...company, taxId: null }, ctx);
    expect(p).toMatchObject({ SposobZaplaty: 'POB', Zaplacono: 0, TerminPlatnosci: '2026-10-01' });
    expect(p.Kontrahent.OsobaFizyczna).toBe(true);
  });

  it('builds an OSS invoice in CZK with the destination rate and the NBP rate', () => {
    const cz = order({ currency: 'CZK', totalAmount: '630.00', shippingAmount: '0', shippingAddress: { ...order().shippingAddress, countryCode: 'CZ' } });
    const p = buildOssPayload(cz, [{ name: 'Krem', quantity: 2, unitPrice: '315.00' }], person, { ...ctx, vatRate: 0.21, exchangeRate: 0.1789 });
    expect(p).toMatchObject({ Jezyk: 'cs', Waluta: 'CZK', KursWalutyZDniaPoprzedzajacegoDzienWystawieniaFaktury: 0.1789, KrajDostawy: 'CZ', KrajWysylki: 'PL', SprzedazUslug: false });
    expect(p.Pozycje).toEqual([{ NazwaPelna: 'Krem', NazwaPelnaObca: 'Krem', Ilosc: 2, CenaJednostkowa: 315, Jednostka: 'szt.', JednostkaObca: 'pcs', StawkaVat: 0.21, TypStawkiVat: 'POD' }]);
    expect(p.Kontrahent).toMatchObject({ OsobaFizyczna: true, AdresZagraniczny: true, KodKraju: 'CZ' });
    expect(() => buildOssPayload(cz, items, person, { ...ctx, vatRate: 0.21 })).toThrow(/exchange rate/);
  });
});

describe('NBP', () => {
  it('takes the last rate before the issue date', async () => {
    server.use(
      http.get('https://api.nbp.pl/api/exchangerates/rates/a/czk/2026-09-22/2026-10-01/', () =>
        HttpResponse.json({ rates: [{ effectiveDate: '2026-09-29', mid: 0.1791 }, { effectiveDate: '2026-09-30', mid: 0.1789 }] }),
      ),
    );
    expect(await nbpRateBefore('CZK', '2026-10-02')).toEqual({ rate: 0.1789, date: '2026-09-30' });
  });
});
