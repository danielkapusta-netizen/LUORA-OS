import { describe, expect, it } from 'vitest';
import { findLockerCode, formatPostalCode, normalizePhone, splitStreet } from '@/server/integrations/address';

describe('splitStreet', () => {
  it.each([
    ['ul. Marszałkowska 10/5', 'ul. Marszałkowska', '10/5'],
    ['Grunwaldzka 182', 'Grunwaldzka', '182'],
    ['Aleja 3 Maja 12A', 'Aleja 3 Maja', '12A'],
    ['Długa 5 m. 3', 'Długa', '5/3'],
    ['os. Kosmonautów 7 lok. 12', 'os. Kosmonautów', '7/12'],
    // A flat given as a letter, which InPost's courier API refused for want of a building number.
    ['Malinowskiego 38/E', 'Malinowskiego', '38/E'],
    ['Kościuszki 7 lok. B', 'Kościuszki', '7/B'],
    ['Główna 45 B', 'Główna', '45B'],
    ['Plac Zbawiciela 3/5/7', 'Plac Zbawiciela', '3/5/7'],
    ['ul. Polna 12 / 4', 'ul. Polna', '12/4'],
    ['Rynek 1-3', 'Rynek', '1-3'],
    ['Długa 10M', 'Długa', '10M'],
    ['ul. 11 Listopada 5', 'ul. 11 Listopada', '5'],
  ])('%s', (line, street, buildingNumber) => {
    expect(splitStreet(line)).toEqual({ street, buildingNumber });
  });

  it('keeps lines without a number intact', () => {
    expect(splitStreet('Rynek Główny')).toEqual({ street: 'Rynek Główny', buildingNumber: '' });
  });
});

describe('normalizePhone', () => {
  it('strips the Polish prefix and separators', () => {
    expect(normalizePhone('+48 600 700 800')).toBe('600700800');
    expect(normalizePhone('0048-600-700-800')).toBe('600700800');
    expect(normalizePhone('600700800')).toBe('600700800');
  });
  it('keeps foreign numbers', () => {
    expect(normalizePhone('+49 30 1234567')).toBe('+49301234567');
    expect(normalizePhone(null)).toBe('');
  });
});

describe('formatPostalCode', () => {
  it('formats Polish codes', () => {
    expect(formatPostalCode('31147')).toBe('31-147');
    expect(formatPostalCode('31-147')).toBe('31-147');
    expect(formatPostalCode('10115', 'DE')).toBe('10115');
  });
});

describe('findLockerCode', () => {
  it('finds InPost locker codes in free text', () => {
    expect(findLockerCode('KRA010 – ul. Długa 5, Kraków')).toBe('KRA010');
    expect(findLockerCode('paczkomat waw01a')).toBe('WAW01A');
    expect(findLockerCode('InPost Paczkomat 24/7')).toBeNull();
  });
});
