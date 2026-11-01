import { describe, expect, it } from 'vitest';
import { commonSlots, dateOnlySlots, nextWorkingDays, parseSlotKey, pickupCourierOf, pickupWindowStart, slotKey } from '@/lib/pickup-slots';

describe('pickup slots', () => {
  it('keeps only the windows every parcel is offered, earliest first', () => {
    const a = { date: '2026-11-03', minTime: '09:00', maxTime: '12:00' };
    const b = { date: '2026-11-03', minTime: '12:00', maxTime: '16:00' };
    const c = { date: '2026-11-04', minTime: '09:00', maxTime: '12:00' };
    expect(commonSlots([[c, b, a], [a, c], [c, a, b]])).toEqual([a, c]);
    expect(commonSlots([[a], [b]])).toEqual([]);
    expect(commonSlots([])).toEqual([]);
  });

  it('round-trips a slot through its form value', () => {
    expect(parseSlotKey(slotKey({ date: '2026-11-03', minTime: '09:00', maxTime: '12:00' }))).toEqual({ date: '2026-11-03', minTime: '09:00', maxTime: '12:00' });
    expect(parseSlotKey(slotKey({ date: '2026-11-03' }))).toEqual({ date: '2026-11-03', minTime: null, maxTime: null });
    expect(parseSlotKey('nonsense')).toBeNull();
  });

  it('skips weekends', () => {
    // Friday 30 Oct 2026, 10:00 in Warsaw.
    const friday = new Date('2026-10-30T09:00:00Z');
    expect(nextWorkingDays(friday, 2)).toEqual(['2026-11-02', '2026-11-03']);
    expect(dateOnlySlots(friday).map((s) => s.date)).toEqual(['2026-10-30', '2026-11-02', '2026-11-03']);
    // After the same-day cut-off, the first InPost day is the next working day.
    expect(dateOnlySlots(new Date('2026-10-30T14:00:00Z'))[0].date).toBe('2026-11-02');
    // On Saturday, Monday comes first.
    expect(dateOnlySlots(new Date('2026-10-31T08:00:00Z'))[0].date).toBe('2026-11-02');
  });

  it('puts a parcel in the column of its courier', () => {
    expect(pickupCourierOf('Allegro Kurier DPD pobranie', 'DPD')).toBe('DPD');
    expect(pickupCourierOf('Allegro Paczkomaty InPost', 'INPOST')).toBe('InPost');
    expect(pickupCourierOf('Allegro Kurier DHL', null)).toBe('DHL');
    expect(pickupCourierOf('Allegro Automat ORLEN Paczka', null)).toBe('ORLEN Paczka');
    // A method that names no courier falls back to the carrier Allegro reported.
    expect(pickupCourierOf('Kurier', 'DHL')).toBe('DHL');
    // Couriers without a column.
    expect(pickupCourierOf('Allegro One Box, One Kurier', 'ALLEGRO')).toBeNull();
    expect(pickupCourierOf('Allegro Pocztex Kurier', 'POCZTA_POLSKA')).toBeNull();
  });

  it('lists labels from the previous working day and today', () => {
    // Wednesday 4 Nov 2026 (winter time, UTC+1): from Tuesday 00:00 Warsaw.
    expect(pickupWindowStart(new Date('2026-11-04T08:00:00Z')).toISOString()).toBe('2026-11-02T23:00:00.000Z');
    // Monday 2 Nov: from Friday, so the weekend's labels are included.
    expect(pickupWindowStart(new Date('2026-11-02T08:00:00Z')).toISOString()).toBe('2026-10-29T23:00:00.000Z');
    // Summer time (UTC+2).
    expect(pickupWindowStart(new Date('2026-07-15T08:00:00Z')).toISOString()).toBe('2026-07-13T22:00:00.000Z');
  });
});
