import { describe, expect, it } from 'vitest';
import { check } from '../scripts/check-i18n';
import { createT } from '@/lib/i18n/translate';

describe('Polish translations', () => {
  it('cover every string used in the code', async () => {
    const { missing, missingPlural, badPlaceholders } = await check();
    expect(missing.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
    expect(missingPlural.map((f) => `${f.file}:${f.line} ${f.text}`)).toEqual([]);
    expect(badPlaceholders.map(([en]) => en)).toEqual([]);
  });
});

describe('createT', () => {
  it('returns the English text and fills placeholders', () => {
    const t = createT('en');
    expect(t('Hello {name}', { name: 'Ola' })).toBe('Hello Ola');
  });

  it('falls back to English for an unknown string in Polish', () => {
    expect(createT('pl')('Not in the dictionary at all')).toBe('Not in the dictionary at all');
  });

  it('uses English one/other plurals', () => {
    const t = createT('en');
    expect(t.plural(1, '{n} order', '{n} orders')).toBe('1 order');
    expect(t.plural(5, '{n} order', '{n} orders')).toBe('5 orders');
  });
});

describe('Polish plurals', () => {
  const t = createT('pl');
  const orders = (n: number) => t.plural(n, '{n} order', '{n} orders');

  it('picks one / few / many by the Polish rules', () => {
    expect(orders(1)).toBe('1 zamówienie');
    expect(orders(2)).toBe('2 zamówienia');
    expect(orders(4)).toBe('4 zamówienia');
    expect(orders(5)).toBe('5 zamówień');
    expect(orders(0)).toBe('0 zamówień');
    expect(orders(12)).toBe('12 zamówień');
    expect(orders(22)).toBe('22 zamówienia');
    expect(orders(25)).toBe('25 zamówień');
  });

  it('translates fixed strings and fills placeholders', () => {
    expect(t('Orders')).toBe('Zamówienia');
    expect(t('Delete {name}?', { name: 'Ola' })).toBe('Usunąć Ola?');
  });
});
