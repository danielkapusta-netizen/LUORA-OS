import { describe, expect, it } from 'vitest';
import { findLockerCode, formatPostalCode, normalizePhone, splitStreet } from '@/server/integrations/address';

describe('splitStreet', () => {
  it.each([
    ['ul. Marszałkowska 10/5', 'ul. Marszałkowska', '10/5'],
    ['Grunwaldzka 182', 'Grunwaldzka', '182'],
    ['Aleja 3 Maja 12A', 'Aleja 3 Maja', '12A'],
    ['Długa 5 m. 3', 'Długa', '5/3'],
    ['os. Kosmonautów 7 lok. 12', 'os. Kosmonautów', '7/12'],
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
    // App-only lockers end in "APP".
    expect(findLockerCode('Inpost Paczkomat · KRA03BAPP')).toBe('KRA03BAPP');
    expect(findLockerCode('waw01app')).toBe('WAW01APP');
    expect(findLockerCode('ABC12DEFGH')).toBeNull();
  });
});
