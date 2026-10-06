import { describe, expect, it } from 'vitest';
import { cohorts, overdueCustomers, recencyScore, repeatStats, segmentCustomers, segmentTag, type CustomerFacts } from '@/lib/crm/segments';
import { desiredTags, DEFAULT_CRM_SETTINGS } from '@/server/services/crm-sync';
import { identityKeys, phoneKey, realEmail } from '@/server/services/customers';

const now = new Date('2026-10-06T12:00:00Z');
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);
const order = (over: Record<string, unknown>) =>
  ({
    marketplace: 'shopify',
    buyer: { name: 'Anna Nowak', email: 'anna@example.com', phone: '+48 600 100 200' },
    shippingAddress: { name: 'Anna Nowak', street: 'Długa 1', city: 'Kraków', postalCode: '30-001', countryCode: 'PL' },
    raw: {},
    ...over,
  }) as never;

describe('who is the customer', () => {
  it('ignores marketplace relay e-mails and invalid ones', () => {
    expect(realEmail(' Anna@Example.com ')).toBe('anna@example.com');
    expect(realEmail('x7f3k+2b1@allegromail.pl')).toBeNull();
    expect(realEmail('buyer-123@marketplace.empik.com')).toBeNull();
    expect(realEmail('not an email')).toBeNull();
    expect(phoneKey('+48 600 100 200')).toBe('600100200');
    expect(phoneKey('123')).toBeNull();
  });

  it('recognises Allegro and Empik buyers by their own ids, and anyone by a real e-mail', () => {
    expect(identityKeys(order({}))).toEqual([{ kind: 'email', value: 'anna@example.com' }]);
    expect(identityKeys(order({ marketplace: 'allegro', raw: { buyer: { id: 'B-77', login: 'anna_n' } }, buyer: { name: 'Anna', email: 'q1@allegromail.pl' } }))).toEqual([
      { kind: 'allegro', value: 'B-77' },
    ]);
    expect(identityKeys(order({ marketplace: 'empik', raw: { customer: { customer_id: 12345 } } }))).toEqual([
      { kind: 'empik', value: '12345' },
      { kind: 'email', value: 'anna@example.com' },
    ]);
    // Nothing stable: name and postcode.
    expect(identityKeys(order({ marketplace: 'vonhalsky', buyer: { name: 'Anna Nowak', email: null } }))).toEqual([{ kind: 'vonhalsky', value: 'anna nowak|30-001' }]);
  });
});

describe('segments', () => {
  const c = (id: string, ordersCount: number, revenue: number, lastDays: number): CustomerFacts => ({
    id,
    ordersCount,
    revenue,
    firstOrderAt: daysAgo(lastDays + 100),
    lastOrderAt: daysAgo(lastDays),
  });

  it('scores recency in bands', () => {
    expect([0, 30, 31, 60, 120, 240, 241].map(recencyScore)).toEqual([5, 5, 4, 4, 3, 2, 1]);
  });

  it('names each customer by recency, orders and spend', () => {
    const list = [
      c('vip', 5, 2000, 10),
      c('loyal', 3, 100, 90),
      c('cant', 4, 1500, 300),
      c('risk3', 3, 50, 300),
      c('promising', 2, 300, 20),
      c('risk2', 2, 300, 200),
      c('new', 1, 80, 5),
      c('once', 1, 80, 90),
      c('lost', 1, 80, 400),
      { id: 'none', ordersCount: 0, revenue: 0, firstOrderAt: null, lastOrderAt: null },
    ];
    const s = segmentCustomers(list, now);
    expect(Object.fromEntries([...s].map(([id, v]) => [id, v.segment]))).toEqual({
      vip: 'vip',
      loyal: 'loyal',
      cant: 'cant_lose',
      risk3: 'at_risk',
      promising: 'promising',
      risk2: 'at_risk',
      new: 'new',
      once: 'one_time',
      lost: 'lost',
    });
    expect(segmentTag('cant_lose')).toBe('luora-cant-lose');
  });

  it('measures repeat purchase and the time to a second order', () => {
    const list = [c('a', 2, 100, 10), c('b', 1, 50, 10), c('c', 3, 200, 10), c('d', 1, 50, 10)];
    const dates = new Map([
      ['a', [daysAgo(40), daysAgo(10)]],
      ['c', [daysAgo(70), daysAgo(60), daysAgo(10)]],
    ]);
    expect(repeatStats(list, dates)).toMatchObject({ customers: 4, repeatCustomers: 2, repeatRate: 0.5, medianDaysToSecond: 30, averageOrders: 1.75 });
  });

  it('builds cohorts by first-order month with the share ordering again each later month', () => {
    const d = (s: string) => new Date(`${s}T12:00:00Z`);
    const dates = new Map([
      ['a', [d('2026-08-03'), d('2026-09-10')]],
      ['b', [d('2026-08-20')]],
      ['c', [d('2026-09-01'), d('2026-09-15')]],
    ]);
    const [sep, aug] = cohorts(dates, 3, now);
    expect(aug).toEqual({ month: '2026-08', size: 2, retention: [1, 0.5, 0] });
    // September's cohort can't have a month +2 yet.
    expect(sep).toEqual({ month: '2026-09', size: 1, retention: [1, 0, null] });
  });

  it('finds regulars who are over twice their usual gap', () => {
    const dates = new Map([
      ['late', [daysAgo(100), daysAgo(80), daysAgo(60)]],
      ['fine', [daysAgo(50), daysAgo(25), daysAgo(5)]],
      ['once', [daysAgo(300)]],
    ]);
    expect(overdueCustomers(dates, now)).toEqual([{ id: 'late', usualGapDays: 20, daysSince: 60 }]);
  });
});

describe('Shopify tags', () => {
  it('writes the segment tag only for chosen segments, and staff tags when asked', () => {
    const settings = { ...DEFAULT_CRM_SETTINGS, syncSegments: ['vip'] };
    expect(desiredTags({ tags: ['wholesale'] }, 'vip', settings)).toEqual(['luora-vip']);
    expect(desiredTags({ tags: ['wholesale'] }, 'loyal', settings)).toEqual([]);
    expect(desiredTags({ tags: ['wholesale'] }, 'vip', { ...settings, syncManualTags: true })).toEqual(['luora-vip', 'wholesale']);
  });
});
