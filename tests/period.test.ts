import { describe, expect, it } from 'vitest';
import { parseCustomRange, resolvePeriod } from '@/lib/analytics/period';

// Wednesday 14 October 2026; the week runs Monday 12th to Sunday 18th.
const NOW = new Date('2026-10-14T12:00:00Z');
const FIRST = new Date('2026-01-05T09:00:00Z');
const day = (d: Date) => d.toISOString().slice(0, 10);

describe('last week', () => {
  const p = resolvePeriod('lastweek', NOW, FIRST, undefined, NOW);

  it('is the whole previous Monday to Sunday', () => {
    expect(day(p.from)).toBe('2026-10-05');
    expect(day(p.to)).toBe('2026-10-11');
    expect(p.to.toISOString()).toBe('2026-10-11T23:59:59.999Z');
    expect(p.days).toBe(7);
    expect(p.label).toBe('Last week');
  });

  it('is compared with the week before it', () => {
    expect(day(p.previous!.from)).toBe('2026-09-28');
    expect(day(p.previous!.to)).toBe('2026-10-04');
    expect(p.comparisonLabel).toBe('vs the week before');
    expect(p.previousCoverage).toBe('full');
  });

  it('does not move when asked on a Monday, nor on a Sunday', () => {
    for (const asked of ['2026-10-12T08:00:00Z', '2026-10-18T22:00:00Z']) {
      const q = resolvePeriod('lastweek', new Date(asked), FIRST, undefined, new Date(asked));
      expect([day(q.from), day(q.to)]).toEqual(['2026-10-05', '2026-10-11']);
    }
  });

  it('follows the newest order when the feed has stalled, like the other periods', () => {
    const stalled = new Date('2026-10-02T10:00:00Z'); // a Friday, twelve days before NOW
    const q = resolvePeriod('lastweek', stalled, FIRST, undefined, NOW);
    expect(q.isAnchoredToData).toBe(true);
    expect([day(q.from), day(q.to)]).toEqual(['2026-09-21', '2026-09-27']);
  });

  it('leaves this week alone', () => {
    const week = resolvePeriod('week', NOW, FIRST, undefined, NOW);
    expect(day(week.from)).toBe('2026-10-12');
  });
});

describe('custom dates', () => {
  it('includes both days', () => {
    const range = parseCustomRange('2026-10-01', '2026-10-09')!;
    const p = resolvePeriod('custom', NOW, FIRST, range, NOW);
    expect([day(p.from), day(p.to)]).toEqual(['2026-10-01', '2026-10-09']);
    expect(p.to.toISOString()).toBe('2026-10-09T23:59:59.999Z');
    expect(p.days).toBe(9);
  });

  it('is compared with the same number of days just before', () => {
    const p = resolvePeriod('custom', NOW, FIRST, parseCustomRange('2026-10-01', '2026-10-09'), NOW);
    expect([day(p.previous!.from), day(p.previous!.to)]).toEqual(['2026-09-22', '2026-09-30']);
    expect(p.comparisonLabel).toBe('vs previous 9 days');
  });

  it('can be a single day', () => {
    const p = resolvePeriod('custom', NOW, FIRST, parseCustomRange('2026-10-09', '2026-10-09'), NOW);
    expect(p.days).toBe(1);
    expect(p.comparisonLabel).toBe('vs previous 1 day');
  });

  it('flags a comparison that reaches back before the first order', () => {
    const p = resolvePeriod('custom', NOW, FIRST, parseCustomRange('2026-01-10', '2026-01-20'), NOW);
    expect(p.previousCoverage).toBe('partial');
  });
});

describe('typing the dates', () => {
  it('puts a reversed pair the right way round', () => {
    const range = parseCustomRange('2026-10-09', '2026-10-01')!;
    expect([day(range.from), day(range.to)]).toEqual(['2026-10-01', '2026-10-09']);
  });

  it('needs both dates, and real ones', () => {
    for (const [from, to] of [
      [undefined, '2026-10-09'],
      ['2026-10-01', undefined],
      ['', ''],
      ['2026-10-01', 'soon'],
      ['2026-02-31', '2026-03-05'], // there is no 31 February
      ['2026-13-01', '2026-13-05'],
      ['10/01/2026', '10/09/2026'],
    ] as [string | undefined, string | undefined][]) {
      expect(parseCustomRange(from, to)).toBeUndefined();
    }
  });
});
