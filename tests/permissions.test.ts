import { describe, expect, it } from 'vitest';
import { courierOf } from '@/lib/couriers';
import { buildLogisticsBrief } from '@/lib/logistics-brief';
import { can, canSeePath, ROLES } from '@/lib/permissions';
import { anyRevealsProfit, scrubDeep, scrubProfitText, zeroProfit } from '@/lib/analytics/redact';

describe('permissions', () => {
  it('admin can do everything, logistics nothing extra, marketing sees margins but not profit', () => {
    expect(['analytics', 'profit', 'margin', 'settings', 'fullDashboard'].map((c) => can('admin', c as never))).toEqual([true, true, true, true, true]);
    expect(['analytics', 'profit', 'margin', 'settings', 'fullDashboard'].map((c) => can('logistics', c as never))).toEqual([false, false, false, false, false]);
    expect(['analytics', 'profit', 'margin', 'settings', 'fullDashboard'].map((c) => can('marketing', c as never))).toEqual([true, false, true, false, true]);
  });

  it('gives an unknown or missing role nothing', () => {
    expect(can('staff', 'analytics')).toBe(false);
    expect(can(null, 'margin')).toBe(false);
    expect(canSeePath('staff', '/orders')).toBe(false);
  });

  it('decides which pages each role sees', () => {
    for (const role of ROLES) expect(canSeePath(role, '/orders')).toBe(true);
    expect(canSeePath('logistics', '/analytics')).toBe(false);
    expect(canSeePath('logistics', '/analytics/products')).toBe(false);
    expect(canSeePath('logistics', '/accounting')).toBe(true);
    expect(canSeePath('marketing', '/analytics/pricing')).toBe(true);
    expect(canSeePath('marketing', '/settings')).toBe(false);
    expect(canSeePath('admin', '/settings/users')).toBe(true);
  });
});

describe('couriers', () => {
  it.each([
    ['Allegro Paczkomaty InPost', 'InPost'],
    ['Paczkomaty InPost - płatność za pobraniem', 'InPost'],
    ['Allegro International Automaty Paczkowe Czechy, InPost', 'InPost'],
    ['Allegro One Box, DPD', 'DPD'],
    ['DPD PICKUP', 'DPD'],
    ['Allegro Kurier DPD Węgry pobranie', 'DPD'],
    ['Allegro Kurier DHL (AD)', 'DHL'],
    ['Allegro Automat ORLEN Paczka', 'ORLEN Paczka'],
    ['Allegro Wysyłka z Polski do Węgier - Automaty Paczkowe Packeta, ORLEN Paczka', 'Packeta'],
    ['Pocztex - płatność za pobraniem', 'Poczta Polska'],
    ['Poczta Polska - odbiór w punkcie', 'Poczta Polska'],
    ['KURIER', 'Other'],
    [null, 'Other'],
  ])('%s -> %s', (name, courier) => {
    expect(courierOf(name)).toBe(courier);
  });

  it('falls back to the shipment carrier when the buyer chose a plain courier', () => {
    expect(courierOf('Kurier', 'inpost')).toBe('InPost');
    expect(courierOf('Kurier', 'allegro_shipping')).toBe('Other');
    expect(courierOf('Allegro One Box, DPD', 'inpost')).toBe('DPD');
  });
});

describe('logistics brief', () => {
  const couriers = [
    { courier: 'InPost' as const, count: 7, labelled: 2 },
    { courier: 'DPD' as const, count: 3, labelled: 0 },
  ];
  it('says what is waiting and with whom it goes, without money', () => {
    const brief = buildLogisticsBrief({ counts: { new: 6, processing: 3, label_created: 1, on_hold: 2 }, couriers, tasksDue: 2, tasksOpen: 5 }, 'Ola', 14);
    expect(brief.greeting).toBe('Good afternoon Ola');
    expect(brief.verdict).toBe('10 orders need to be sent.');
    expect(brief.body.join(' ')).toContain('InPost (7), DPD (3)');
    expect(brief.body.join(' ')).toContain('2 orders are on hold');
    expect(brief.body.join(' ')).toContain('2 tasks due today or late, 5 open');
    expect(JSON.stringify(brief)).not.toMatch(/zł|profit|revenue/i);
  });
  it('handles an empty queue', () => {
    const brief = buildLogisticsBrief({ counts: {}, couriers: [], tasksDue: 0, tasksOpen: 0 }, undefined, 8);
    expect(brief.verdict).toBe('Nothing is waiting to be sent.');
    expect(brief.greeting).toBe('Good morning');
  });
});

describe('profit redaction', () => {
  it('drops sentences that say how much profit was made, keeps margins', () => {
    const text = 'Revenue rose 54%. Profit rose 65% in the same time. Margin improved to 40.3%.';
    expect(scrubProfitText(text)).toBe('Revenue rose 54%. Margin improved to 40.3%.');
    expect(scrubProfitText('It returns only 120 zł of profit — against a 15% target.')).toBe('');
    expect(scrubProfitText('Fundamentals are sound at 40% margin, with 3 dragging on profit.')).toContain('40% margin');
    expect(scrubProfitText('31% of all profit comes from one product.')).toContain('31%');
  });
  it('finds profit figures anywhere in nested data and zeroes profit amounts', () => {
    expect(anyRevealsProfit({ a: ['ok', { b: 'It made 4 074 zł of profit.' }] })).toBe(true);
    expect(anyRevealsProfit({ a: 'Revenue 4 074 zł' })).toBe(false);
    expect(scrubDeep({ why: 'Profit grew 5.0% against 3.0% revenue growth.' }).why).toBe('');
    const zeroed = zeroProfit({ marginPLN: 99, marginPct: 12, rows: [{ marginPLN: 5, revenuePLN: 7 }] });
    expect(zeroed).toEqual({ marginPLN: 0, marginPct: 12, rows: [{ marginPLN: 0, revenuePLN: 7 }] });
  });
});
