// Filling the parameters of a new Allegro product from the Shopify product.
import { describe, expect, it } from 'vitest';
import { categoryPath, fillParameter, parseNumber, productParameters, type AllegroCategoryParameter } from '@/server/integrations/marketplaces/allegro/product-parameters';

const ean: AllegroCategoryParameter = { id: '225693', name: 'EAN (GTIN)', type: 'string', unit: null, required: false, requiredForProduct: true, describesProduct: true };
const brand: AllegroCategoryParameter = {
  id: '248811', name: 'Marka', type: 'dictionary', unit: null, required: true, requiredForProduct: true, describesProduct: true,
  dictionary: [{ id: 'b1', value: 'Luora' }, { id: 'b9', value: 'inna' }], ambiguousValueId: 'b9', customValuesEnabled: true,
};
const capacity: AllegroCategoryParameter = { id: '17448', name: 'Pojemność', type: 'float', unit: 'ml', required: true, requiredForProduct: true, describesProduct: true, min: 0.1, max: 5000 };
const condition: AllegroCategoryParameter = { id: '11323', name: 'Stan', type: 'dictionary', unit: null, required: true, requiredForProduct: false, describesProduct: false, dictionary: [{ id: '11323_1', value: 'Nowy' }] };
const skin: AllegroCategoryParameter = { id: '300', name: 'Rodzaj skóry', type: 'dictionary', unit: null, required: false, requiredForProduct: false, describesProduct: true, multipleChoices: true, dictionary: [{ id: 's1', value: 'Sucha' }, { id: 's2', value: 'Tłusta' }] };
const product = { ean: '5901234567890', brand: 'Luora', metafields: { 'custom.capacity': '50 ml' } };

describe('new Allegro product parameters', () => {
  it('fills EAN, brand and condition by themselves and reports what is still missing', () => {
    expect(productParameters([ean, brand, capacity, condition], product)).toEqual({
      productParameters: [{ id: '225693', values: ['5901234567890'] }, { id: '248811', valuesIds: ['b1'] }],
      offerParameters: [{ id: '11323', valuesIds: ['11323_1'] }],
      missing: ['Pojemność'],
      invalid: [],
    });
  });

  it('reads the others from a metafield, else the fixed value', () => {
    const sources = { Pojemność: { metafield: 'custom.capacity', fallback: '100' } };
    expect(productParameters([capacity], product, sources).productParameters).toEqual([{ id: '17448', values: ['50'] }]);
    expect(productParameters([capacity], { ...product, metafields: {} }, sources).productParameters).toEqual([{ id: '17448', values: ['100'] }]);
  });

  it('sends a brand missing from the dictionary as a custom value when Allegro allows it', () => {
    expect(productParameters([brand], { ...product, brand: 'Nida' }).productParameters).toEqual([{ id: '248811', valuesIds: ['b9'], values: ['Nida'] }]);
    const closed = { ...brand, customValuesEnabled: false };
    expect(productParameters([closed], { ...product, brand: 'Nida' })).toMatchObject({ productParameters: [], invalid: ['Marka "Nida" is not accepted'] });
  });

  it('checks numbers and their limits, and matches dictionary labels', () => {
    expect(fillParameter(capacity, 'abc')).toEqual({ ok: false, problem: 'Pojemność "abc" is not a number' });
    expect(fillParameter(capacity, '9000 ml')).toMatchObject({ ok: false, problem: expect.stringContaining('outside') });
    expect(fillParameter(skin, 'sucha; TŁUSTA')).toEqual({ ok: true, value: { id: '300', valuesIds: ['s1', 's2'] } });
    expect(fillParameter({ ...skin, multipleChoices: false }, 'sucha; tłusta')).toEqual({ ok: true, value: { id: '300', valuesIds: ['s1'] } });
  });

  it('leaves out an optional parameter it cannot fill instead of blocking the product', () => {
    expect(productParameters([skin], product, { 'Rodzaj skóry': { fallback: 'Mieszana' } })).toEqual({ productParameters: [], offerParameters: [], missing: [], invalid: [] });
  });

  it('parses numbers with units and Polish decimals', () => {
    expect([parseNumber('50 ml'), parseNumber('50,5'), parseNumber('1 234 g'), parseNumber('none')]).toEqual([50, 50.5, 1234, null]);
  });

  it('builds the category path from Allegro’s parents', () => {
    expect(categoryPath({ name: 'Kremy', parent: { name: 'Pielęgnacja', parent: { name: 'Uroda', parent: null } } })).toBe('Uroda > Pielęgnacja > Kremy');
  });
});
