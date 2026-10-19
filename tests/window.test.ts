import { describe, expect, it } from 'vitest';
import { dayEnd, dayStart, quickRanges, resolveDayWindow, today } from '@/lib/analytics/window';

// Wednesday 14 October 2026.
const NOW = new Date('2026-10-14T12:00:00Z');

describe('the shop day', () => {
  it('begins and ends at midnight in Warsaw, summer and winter', () => {
    expect(dayStart('2026-10-05').toISOString()).toBe('2026-10-04T22:00:00.000Z');
    expect(dayEnd('2026-10-05').toISOString()).toBe('2026-10-05T21:59:59.999Z');
    expect(dayStart('2026-12-05').toISOString()).toBe('2026-12-04T23:00:00.000Z');
  });

  it('is 25 hours long when the clocks go back and 23 when they go forward', () => {
    expect(dayEnd('2026-10-25').getTime() - dayStart('2026-10-25').getTime() + 1).toBe(25 * 3_600_000);
    expect(dayEnd('2026-03-29').getTime() - dayStart('2026-03-29').getTime() + 1).toBe(23 * 3_600_000);
  });

  it('knows that late evening in UTC is already tomorrow in Warsaw', () => {
    expect(today(new Date('2026-10-14T21:30:00Z'))).toBe('2026-10-14');
    expect(today(new Date('2026-10-14T22:30:00Z'))).toBe('2026-10-15');
  });
});

describe('rolling windows', () => {
  it('end now and reach back the chosen number of days', () => {
    const w = resolveDayWindow({ days: '7' }, [7, 30, 90], 30, NOW);
    expect(w).toMatchObject({ key: '7', label: '7 days' });
    expect(w.to).toEqual(NOW);
    expect(w.from).toEqual(new Date('2026-10-07T12:00:00Z'));
    expect(w.custom).toBeUndefined();
  });

  it('fall back to the default for a missing or unknown value', () => {
    for (const days of [undefined, '8', 'abc', '']) expect(resolveDayWindow({ days }, [7, 30, 90], 30, NOW).key).toBe('30');
  });
});

describe('last week', () => {
  it('is the whole previous Monday to Sunday', () => {
    const w = resolveDayWindow({ days: 'lastweek' }, [7, 30], 30, NOW);
    expect(w.key).toBe('lastweek');
    expect(w.from.toISOString()).toBe('2026-10-04T22:00:00.000Z'); // Monday 5th, midnight in Warsaw
    expect(w.to.toISOString()).toBe('2026-10-11T21:59:59.999Z'); // Sunday 11th, last millisecond
  });
});

describe('custom dates', () => {
  it('include both days and win over a preset', () => {
    const w = resolveDayWindow({ days: '7', from: '2026-10-01', to: '2026-10-09' }, [7, 30], 30, NOW);
    expect(w.key).toBe('custom');
    expect(w.custom).toEqual({ from: '2026-10-01', to: '2026-10-09' });
    expect(w.from.toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(w.to.toISOString()).toBe('2026-10-09T21:59:59.999Z');
    expect(w.label).toBe('1 Oct – 9 Oct');
  });

  it('are put the right way round', () => {
    const w = resolveDayWindow({ from: '2026-10-09', to: '2026-10-01' }, [7, 30], 30, NOW);
    expect(w.custom).toEqual({ from: '2026-10-01', to: '2026-10-09' });
  });

  it('need both days, real ones', () => {
    for (const input of [{ from: '2026-10-01' }, { to: '2026-10-01' }, { from: '2026-02-31', to: '2026-03-02' }, { from: 'x', to: 'y' }]) {
      expect(resolveDayWindow(input, [7, 30], 30, NOW).key).toBe('30');
    }
  });
});

describe('quick ranges for the Orders filter', () => {
  it('cover today, yesterday, this and last week, and this month', () => {
    expect(Object.fromEntries(quickRanges(NOW).map((r) => [r.label, [r.from, r.to]]))).toEqual({
      Today: ['2026-10-14', '2026-10-14'],
      Yesterday: ['2026-10-13', '2026-10-13'],
      'This week': ['2026-10-12', '2026-10-14'],
      'Last week': ['2026-10-05', '2026-10-11'],
      'This month': ['2026-10-01', '2026-10-14'],
    });
  });

  it('start the week on Monday even when asked on a Sunday or a Monday', () => {
    const week = (d: string) => quickRanges(new Date(d)).find((r) => r.label === 'This week')!.from;
    expect(week('2026-10-18T10:00:00Z')).toBe('2026-10-12');
    expect(week('2026-10-12T10:30:00Z')).toBe('2026-10-12');
  });

  it("follow Warsaw's calendar: just after midnight there is already Monday", () => {
    // 22:30 UTC on Sunday the 18th is 00:30 on Monday the 19th in Warsaw.
    const ranges = Object.fromEntries(quickRanges(new Date('2026-10-18T22:30:00Z')).map((r) => [r.label, [r.from, r.to]]));
    expect(ranges.Today).toEqual(['2026-10-19', '2026-10-19']);
    expect(ranges['This week']).toEqual(['2026-10-19', '2026-10-19']);
    expect(ranges['Last week']).toEqual(['2026-10-12', '2026-10-18']);
  });
});
