import { describe, expect, it } from 'vitest';
import { allocate, orderEconomics, vatRateFor, type EconomicsInput } from '@/server/analytics/economics';
import { DEFAULT_ANALYTICS_SETTINGS } from '@/server/services/costs';

const settings = {
  ...DEFAULT_ANALYTICS_SETTINGS,
  fallbackCommission: { allegro: 0.1, empik: 0.15, shopify: 0.02, vonhalsky: 0.1 },
  labelCosts: { inpost_locker_standard: 10, inpost_courier_standard: 14, allegro_shipping: 9 },
  defaultLabelCost: 12,
  packagingCost: 2,
  feesVatDeductible: true,
};

function input(overrides: Partial<EconomicsInput> = {}): EconomicsInput {
  return {
    marketplace: 'allegro',
    fxRate: 1,
    vatRate: 0.23,
    feeVatRate: 0.23,
    shippingAmount: 0,
    settings,
    items: [{ id: 'a', productId: 'p1', quantity: 2, unitPrice: 61.5, discount: 0, unitCost: 20 }],
    fees: [],
    refunds: [],
    shipments: [{ carrier: 'inpost', service: 'inpost_locker_standard' }],
    ...overrides,
  };
}

describe('VAT rate of a sale', () => {
  it('uses the Polish rate at home, the destination rate in the EU, none outside it', () => {
    expect(vatRateFor('PL', { defaultVatRate: 0.23 })).toBe(0.23);
    expect(vatRateFor(null, {})).toBe(0.23);
    expect(vatRateFor('cz', {})).toBe(0.21);
    expect(vatRateFor('CZ', { ossRates: { CZ: 0.12 } })).toBe(0.12);
    expect(vatRateFor('UA', {})).toBe(0);
  });
});

describe('allocate', () => {
  it('splits by weight, or equally when nothing has weight', () => {
    expect(allocate(10, [1, 3])).toEqual([2.5, 7.5]);
    expect(allocate(9, [0, 0, 0])).toEqual([3, 3, 3]);
    expect(allocate(5, [])).toEqual([]);
  });
});

describe('order economics', () => {
  it('estimates the commission when the marketplace reported no fee, without its VAT', () => {
    const [line] = orderEconomics(input());
    // 123 gross → 100 net; commission 10% of 123 = 12.30 gross = 10 net; cost 40; label 10 + packaging 2.
    expect(line).toMatchObject({ gross: 123, net: 100, fees: 10, feesEstimated: true, cost: 40, costKnown: true, delivery: 12, profit: 38 });
  });

  it('uses reported fees: VAT taken off where reported, line fees on their line, the rest spread by value', () => {
    const lines = orderEconomics(
      input({
        items: [
          { id: 'a', productId: 'p1', quantity: 1, unitPrice: 100, discount: 0, unitCost: 30 },
          { id: 'b', productId: null, quantity: 1, unitPrice: 300, discount: 0, unitCost: null },
        ],
        fees: [
          { itemId: 'a', kind: 'commission', amount: 12.3, tax: 2.3 },
          { itemId: null, kind: 'promotion', amount: 40, tax: 0 },
        ],
        shipments: [],
      }),
    );
    expect(lines[0]).toMatchObject({ fees: 20, feesEstimated: false, costKnown: true });
    expect(lines[1]).toMatchObject({ fees: 30, cost: 0, costKnown: false });
    // No label bought here: one parcel at the default cost plus packaging, spread 1:3.
    expect(lines.map((l) => l.delivery)).toEqual([3.5, 10.5]);
  });

  it("lets Allegro's delivery charge replace the configured Allegro Delivery label", () => {
    const withCharge = orderEconomics(
      input({ fees: [{ itemId: null, kind: 'delivery', amount: 6.15, tax: 1.15 }], shipments: [{ carrier: 'allegro_shipping', service: 'buyer_choice' }] }),
    )[0];
    expect(withCharge.delivery).toBe(7); // 5 net charge + 2 packaging, no label
    expect(withCharge.fees).toBe(0);
    const withoutCharge = orderEconomics(input({ fees: [{ itemId: null, kind: 'commission', amount: 0, tax: 0 }], shipments: [{ carrier: 'allegro_shipping', service: 'buyer_choice' }] }))[0];
    expect(withoutCharge.delivery).toBe(11); // 9 label + 2 packaging
  });

  it('adds the shipping the buyer paid and converts foreign orders at the order day rate', () => {
    const [line] = orderEconomics(input({ marketplace: 'shopify', fxRate: 4.3, vatRate: 0.21, shippingAmount: 12.1, items: [{ id: 'a', productId: 'p1', quantity: 1, unitPrice: 24.2, discount: 0, unitCost: 30 }] }));
    expect(line.gross).toBe(104.06);
    expect(line.net).toBe(86);
    expect(line.shipping).toBe(43);
    // Shopify's fallback is a payment fee with no VAT: 2% of the gross.
    expect(line.fees).toBe(2.08);
  });

  it('takes discounts off the revenue and gives the cost of restocked returns back', () => {
    const [line] = orderEconomics(
      input({
        items: [{ id: 'a', productId: 'p1', quantity: 2, unitPrice: 61.5, discount: 12.3, unitCost: 20 }],
        fees: [{ itemId: 'a', kind: 'commission', amount: 0, tax: 0 }],
        refunds: [{ itemId: 'a', amount: 55.35, quantity: 1, restocked: true }],
      }),
    );
    expect(line).toMatchObject({ gross: 110.7, net: 90, discount: 12.3, refundedQuantity: 1 });
    // 55.35 back = 45 net, minus the unit (20) that returned to stock.
    expect(line.refunds).toBe(25);
    expect(line.profit).toBe(90 - 40 - 12 - 25);
  });

  it('spreads an order-level refund over the lines', () => {
    const lines = orderEconomics(
      input({
        items: [
          { id: 'a', productId: 'p1', quantity: 1, unitPrice: 123, discount: 0, unitCost: 10 },
          { id: 'b', productId: 'p2', quantity: 1, unitPrice: 123, discount: 0, unitCost: 10 },
        ],
        refunds: [{ itemId: null, amount: 24.6, quantity: null, restocked: false }],
      }),
    );
    expect(lines.map((l) => l.refunds)).toEqual([10, 10]);
  });
});
