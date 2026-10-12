import { describe, expect, it } from 'vitest';
import { netPrice, parseInvoiceLines, sharedCosts, toNumber } from '@/lib/invoice';

describe('invoice lines', () => {
  it('reads barcode; quantity; price lines', () => {
    expect(parseInvoiceLines('8809562191438;3;6.25\n8809151133610\t3\t5,37\n')).toEqual([
      { key: '8809562191438', qty: 3, price: 6.25 },
      { key: '8809151133610', qty: 3, price: 5.37 },
    ]);
  });

  it('finds the barcode in a whole row copied from the invoice table and ignores the amount', () => {
    const row = '1\t(EU Package) FRESH BLUE HYSSOP RICE MOCHI CLEANSER 120G\tARENCIA\t3401.30.0000\t8809562191070\t3\t6.49\t23.95';
    expect(parseInvoiceLines(row)).toEqual([{ key: '8809562191070', qty: 3, price: 6.49 }]);
  });

  it('takes a name as the key, counts "key; price" as one piece and skips headers and totals', () => {
    expect(parseInvoiceLines('Round Lab Cleanser 150ml;5;4.73\nLUO-MUG-01;18,40\nIDX;DESCRIPTION;BRAND\nTOTAL;109;EUR')).toEqual([
      { key: 'Round Lab Cleanser 150ml', qty: 5, price: 4.73 },
      { key: 'LUO-MUG-01', qty: 1, price: 18.4 },
    ]);
  });

  it('parses amounts written either way', () => {
    expect([toNumber('1 234,50'), toNumber('6.49'), toNumber('x'), toNumber(undefined)]).toEqual([1234.5, 6.49, null, null]);
  });
});

describe('invoice costs', () => {
  const terms = { vatIncluded: false, vatRate: 0.23, deliveryTotal: 10, deliveryIncludesVat: true, extraPln: 0 };

  it('keeps net prices and takes VAT out of gross ones', () => {
    expect(netPrice(6.49, terms)).toBe(6.49);
    expect(netPrice(7.98, { ...terms, vatIncluded: true })).toBeCloseTo(6.4878, 3);
  });

  it('spreads the net delivery and the extras evenly over all pieces', () => {
    const s = sharedCosts(109, terms, 4.3855);
    expect(s.freightPln).toBeCloseTo((10 / 1.23 / 109) * 4.3855, 6);
    expect(s.extraPln).toBe(0);
    expect(sharedCosts(10, { ...terms, deliveryTotal: 20, deliveryIncludesVat: false, extraPln: 50 }, 2)).toEqual({ freightPln: 4, extraPln: 5 });
    expect(sharedCosts(0, terms, 4)).toEqual({ freightPln: 0, extraPln: 0 });
  });
});
