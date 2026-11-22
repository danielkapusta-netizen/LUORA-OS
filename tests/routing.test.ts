import { describe, expect, it } from 'vitest';
import { chooseRoute, describeConditions, matchesRule, type CarrierLike, type RuleLike } from '@/server/services/routing';

const carriers: CarrierLike[] = [
  { id: 'inpost', type: 'inpost', enabled: true, configured: true, marketplaceAccountId: null },
  { id: 'allegro', type: 'allegro_shipping', enabled: true, configured: true, marketplaceAccountId: 'allegro-main' },
];

const rule = (r: Partial<RuleLike> & Pick<RuleLike, 'id' | 'carrierAccountId' | 'service'>): RuleLike => ({
  name: r.id,
  priority: 100,
  enabled: true,
  conditions: {},
  packagePresetId: null,
  ...r,
});

const defaults = [
  rule({ id: 'allegro-orders', priority: 10, conditions: { marketplaces: ['allegro'] }, carrierAccountId: 'allegro', service: 'buyer_choice' }),
  rule({ id: 'lockers', priority: 20, conditions: { hasPickupPoint: true }, carrierAccountId: 'inpost', service: 'inpost_locker_standard' }),
  rule({ id: 'rest', priority: 30, carrierAccountId: 'inpost', service: 'inpost_courier_standard' }),
];

const order = (o: Partial<Parameters<typeof chooseRoute>[0]> = {}) => ({
  accountId: o.marketplace === 'allegro' ? 'allegro-main' : 'shop-1',
  marketplace: 'shopify' as const,
  deliveryMethodName: 'Kurier InPost',
  pickupPointId: null,
  codAmount: null,
  ...o,
});

describe('chooseRoute', () => {
  it('sends Allegro orders through Allegro Delivery', () => {
    expect(chooseRoute(order({ marketplace: 'allegro', pickupPointId: 'POZ08A' }), defaults, carriers)?.ruleId).toBe('allegro-orders');
  });

  it('sends Shopify and Empik orders with a pickup point to an InPost locker', () => {
    expect(chooseRoute(order({ pickupPointId: 'KRA010' }), defaults, carriers)?.service).toBe('inpost_locker_standard');
    expect(chooseRoute(order({ marketplace: 'empik', pickupPointId: 'WAW01A' }), defaults, carriers)?.service).toBe('inpost_locker_standard');
  });

  it('falls back to the courier rule', () => {
    expect(chooseRoute(order(), defaults, carriers)?.ruleId).toBe('rest');
  });

  it('never routes a non-Allegro order to Allegro Delivery, even by a catch-all rule', () => {
    const rules = [rule({ id: 'all-allegro', priority: 1, carrierAccountId: 'allegro', service: 'buyer_choice' }), ...defaults];
    expect(chooseRoute(order(), rules, carriers)?.ruleId).toBe('rest');
  });

  it('skips disabled rules and disabled carriers', () => {
    const rules = defaults.map((r) => (r.id === 'lockers' ? { ...r, enabled: false } : r));
    expect(chooseRoute(order({ pickupPointId: 'KRA010' }), rules, carriers)?.ruleId).toBe('rest');
    const noInpost = carriers.map((c) => (c.id === 'inpost' ? { ...c, enabled: false } : c));
    expect(chooseRoute(order(), defaults, noInpost)).toBeNull();
  });

  it('skips carriers without working credentials (e.g. leftover demo accounts)', () => {
    const demoInpost = carriers.map((c) => (c.id === 'inpost' ? { ...c, configured: false } : c));
    expect(chooseRoute(order({ pickupPointId: 'KRA010' }), defaults, demoInpost)).toBeNull();
    const backup = [...defaults, rule({ id: 'backup', priority: 99, carrierAccountId: 'inpost-real', service: 'inpost_courier_standard' })];
    const withReal = [...demoInpost, { id: 'inpost-real', type: 'inpost' as const, enabled: true, configured: true, marketplaceAccountId: null }];
    expect(chooseRoute(order({ pickupPointId: 'KRA010' }), backup, withReal)?.ruleId).toBe('backup');
  });

  it('uses Allegro Delivery only for orders from its own Allegro account', () => {
    const other = order({ marketplace: 'allegro', pickupPointId: 'POZ08A' });
    expect(chooseRoute({ ...other, accountId: 'allegro-second' }, defaults, carriers)?.ruleId).toBe('lockers');
    expect(chooseRoute(other, defaults, carriers)?.ruleId).toBe('allegro-orders');
  });

  it('respects priority regardless of array order', () => {
    expect(chooseRoute(order({ marketplace: 'allegro' }), [...defaults].reverse(), carriers)?.ruleId).toBe('allegro-orders');
  });
});

describe('matchesRule', () => {
  it('matches delivery method case-insensitively and COD', () => {
    expect(matchesRule(order({ deliveryMethodName: 'Kurier InPost – POBRANIE', codAmount: '99.00' }), { deliveryMethodContains: 'pobranie', cod: true })).toBe(true);
    expect(matchesRule(order({ codAmount: '0' }), { cod: true })).toBe(false);
  });

  it('describes conditions for the settings page', () => {
    expect(describeConditions({})).toBe('every order');
    expect(describeConditions({ marketplaces: ['allegro'], hasPickupPoint: true })).toBe('marketplace is allegro, has a pickup point');
  });
});

describe('Empik DPD orders', () => {
  const withDpd: CarrierLike[] = [
    ...carriers,
    { id: 'dpd', type: 'dpd', enabled: true, configured: true, marketplaceAccountId: null },
    { id: 'dpd-empik', type: 'dpd', enabled: true, configured: true, marketplaceAccountId: null },
  ];
  // The rules "Route Empik … orders here" adds on the DPD account pages.
  const rules = [
    ...defaults,
    rule({ id: 'empik-salon', priority: 14, conditions: { marketplaces: ['empik'], deliveryMethodContains: 'Salonu Empik' }, carrierAccountId: 'dpd-empik', service: 'dpd_pickup' }),
    rule({ id: 'empik-dpd', priority: 15, conditions: { marketplaces: ['empik'], deliveryMethodContains: 'DPD' }, carrierAccountId: 'dpd', service: 'dpd_pickup' }),
  ];

  it('sends DPD PICKUP to the DPD account and salons to the Empik-agreement account', () => {
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'DPD PICKUP', pickupPointId: 'PL19262' }), rules, withDpd)).toMatchObject({ ruleId: 'empik-dpd', carrierAccountId: 'dpd', service: 'dpd_pickup' });
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'Dostawa do Salonu Empik', pickupPointId: 'PL49033' }), rules, withDpd)).toMatchObject({ ruleId: 'empik-salon', carrierAccountId: 'dpd-empik' });
  });

  it('keeps Empik couriers and Paczkomaty, and other marketplaces, on InPost', () => {
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'KURIER' }), rules, withDpd)?.service).toBe('inpost_courier_standard');
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'Paczkomaty InPost', pickupPointId: 'WAW01A' }), rules, withDpd)?.service).toBe('inpost_locker_standard');
    // The Empik rules don't take other marketplaces; a HEBE order to a DPD point still never goes to an InPost locker.
    expect(chooseRoute(order({ marketplace: 'hebe', deliveryMethodName: 'DPD Pickup', pickupPointId: 'PL1' }), rules, withDpd)).toBeNull();
    expect(chooseRoute(order({ marketplace: 'hebe', deliveryMethodName: 'Punkt Odbioru', pickupPointId: 'BBI48M' }), rules, withDpd)?.ruleId).toBe('lockers');
  });
});

describe('orders to a DPD point', () => {
  const withDpd: CarrierLike[] = [...carriers, { id: 'dpd', type: 'dpd', enabled: true, configured: true, marketplaceAccountId: null }];

  it('never go to InPost, even before the DPD rules exist', () => {
    // Only the default rules: the salon order has a point, but the Paczkomat rule and the courier catch-all are InPost.
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'Dostawa do Salonu Empik', pickupPointId: 'PL49298' }), defaults, withDpd)).toBeNull();
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'DPD PICKUP', pickupPointId: 'PL19262' }), defaults, withDpd)).toBeNull();
  });

  it('go with DPD once a rule sends them there', () => {
    const rules = [...defaults, rule({ id: 'salon', priority: 14, conditions: { marketplaces: ['empik'], deliveryMethodContains: 'Salonu Empik' }, carrierAccountId: 'dpd', service: 'dpd_pickup' })];
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'Dostawa do Salonu Empik', pickupPointId: 'PL49298' }), rules, withDpd)?.carrierAccountId).toBe('dpd');
  });

  it('leave InPost lockers, Żabka and couriers as they were', () => {
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'Paczkomaty InPost', pickupPointId: 'WAW01A' }), defaults, withDpd)?.service).toBe('inpost_locker_standard');
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'Żabka', pickupPointId: '400666' }), defaults, withDpd)?.service).toBe('inpost_locker_standard');
    expect(chooseRoute(order({ marketplace: 'empik', deliveryMethodName: 'KURIER' }), defaults, withDpd)?.service).toBe('inpost_courier_standard');
    expect(chooseRoute(order({ deliveryMethodName: 'InPost Paczkomat 24/7', pickupPointId: 'KRA010' }), defaults, withDpd)?.service).toBe('inpost_locker_standard');
  });
});
