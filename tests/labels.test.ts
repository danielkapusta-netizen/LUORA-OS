import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { MockCarrierAdapter } from '@/server/integrations/carriers/mock/adapter';
import { labelReference, mergeLabels } from '@/server/services/shipping';
import { marketplaceQuantity, pendingUpdatesFor } from '@/server/services/inventory';

async function mockLabel(id: string) {
  const carrier = new MockCarrierAdapter('inpost');
  const { externalId } = await carrier.createShipment({
    shipmentId: id,
    service: 'inpost_courier_standard',
    sender: { name: 'Magazyn', street: 'Magazynowa 5', city: 'Warszawa', postalCode: '02-222', countryCode: 'PL', phone: '500600700', email: 'a@b.pl' },
    receiver: { name: 'Łukasz Żółć', street: 'Świętokrzyska 1', city: 'Łódź', postalCode: '90-001', countryCode: 'PL' },
    parcel: { lengthCm: 10, widthCm: 10, heightCm: 10, weightKg: 1 },
    currency: 'PLN',
    reference: '#1',
    labelFormat: 'pdf',
  });
  return carrier.getLabels([externalId], { format: 'pdf', size: 'A6' });
}

describe('labels', () => {
  it('draws mock labels with Polish names and merges them into one PDF', async () => {
    const files = [await mockLabel('a'), await mockLabel('b'), await mockLabel('c')].map((content) => ({ format: 'pdf' as const, content }));
    const merged = await mergeLabels(files);
    expect(merged.format).toBe('pdf');
    expect((await PDFDocument.load(merged.content)).getPageCount()).toBe(3);
  });

  it('concatenates ZPL labels', async () => {
    const merged = await mergeLabels([
      { format: 'zpl', content: Buffer.from('^XA^FDone^XZ') },
      { format: 'zpl', content: Buffer.from('^XA^FDtwo^XZ') },
    ]);
    expect(merged).toEqual({ format: 'zpl', content: Buffer.from('^XA^FDone^XZ\n^XA^FDtwo^XZ\n') });
  });

  it('refuses an empty merge', async () => {
    await expect(mergeLabels([])).rejects.toThrow('No labels');
  });

  it('puts the order number and product names in the label reference, within 100 characters', () => {
    expect(labelReference('40102409185604', [{ name: 'Arencia, Vitamin C Booster Shot rozświetlające serum 30 ml', quantity: 1 }])).toBe(
      '40102409185604: 1x Arencia, Vitamin C Booster Shot rozświetlające serum 30 ml',
    );
    expect(labelReference('40102409712336', [
      { name: 'Notebook', quantity: 2 },
      { name: 'Anua Heartleaf 77% Soothing Toner 250 ml koreański tonik', quantity: 1 },
    ])).toBe('40102409712336: 2x Notebook, 1x Anua Heartleaf 77% Soothing');
    expect(labelReference('#1042', [])).toBe('#1042');
    const long = labelReference('6B7C4270', Array.from({ length: 8 }, (_, i) => ({ name: `Product number ${i} with a long name`, quantity: 1 })));
    expect(long.length).toBe(100);
    expect(long.startsWith('6B7C4270: 1x Product number 0')).toBe(true);
    expect(long.endsWith('...')).toBe(true);
  });
});

describe('stock push planning', () => {
  it('only sends listings whose last pushed quantity differs, never below zero', () => {
    const rows = [
      { listingId: '1', externalId: 'a', sku: 'A', ref: {}, stock: 5, lastPushedQty: 5 },
      { listingId: '2', externalId: 'b', sku: 'B', ref: {}, stock: 4, lastPushedQty: 5 },
      { listingId: '3', externalId: 'c', sku: 'C', ref: {}, stock: -2, lastPushedQty: null },
      { listingId: '4', externalId: 'd', sku: 'D', ref: {}, stock: -1, lastPushedQty: 0 },
    ];
    expect(pendingUpdatesFor(rows).map((u) => [u.listingId, u.quantity])).toEqual([
      ['2', 4],
      ['3', 0],
    ]);
  });

  it('shows the newer of the pushed and imported quantity', () => {
    const t1 = new Date('2026-09-01');
    const t2 = new Date('2026-09-02');
    expect(marketplaceQuantity({ lastSeenQty: 10, lastSeenAt: t1, lastPushedQty: 7, lastPushedAt: t2 })).toBe(7);
    expect(marketplaceQuantity({ lastSeenQty: 9, lastSeenAt: t2, lastPushedQty: 7, lastPushedAt: t1 })).toBe(9);
    expect(marketplaceQuantity({ lastSeenQty: 3, lastSeenAt: t1, lastPushedQty: null, lastPushedAt: null })).toBe(3);
  });
});

describe('merged labels follow the list', () => {
  it('keeps the order of the ids, once each, leaving out ids without a label', async () => {
    const { inGivenOrder } = await import('@/server/services/shipping');
    // Files saved in another order than the list on screen.
    const found = new Map([
      ['c', 'label c'],
      ['a', 'label a'],
      ['b', 'label b'],
    ]);
    expect(inGivenOrder(['b', 'a', 'x', 'c', 'a'], found)).toEqual(['label b', 'label a', 'label c']);
  });
});
