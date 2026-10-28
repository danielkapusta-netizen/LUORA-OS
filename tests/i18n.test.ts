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
