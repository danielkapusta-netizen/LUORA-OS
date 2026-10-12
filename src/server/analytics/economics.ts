// The profit of one order, split over its lines. Pure: everything it needs is passed in, so the
// rules are unit-tested and the same numbers come out wherever they are computed.
//
//   net revenue  = paid for the goods (after discounts) without VAT
//   − fees       = marketplace and payment fees without deductible VAT (or the fallback commission)
//   − cost       = landed unit cost on the order day × units
//   + shipping   = shipping the buyer paid, without VAT
//   − delivery   = labels, packaging and marketplace delivery charges
//   − refunds    = money returned without VAT, less the cost of goods that came back to stock
//   = profit
import type { AnalyticsSettings, FeeKind } from '../db/schema';

/** Standard VAT rates of EU countries, used for OSS sales unless the accounting settings override them. */
export const EU_STANDARD_VAT: Record<string, number> = {
  AT: 0.2, BE: 0.21, BG: 0.2, HR: 0.25, CY: 0.19, CZ: 0.21, DK: 0.25, EE: 0.24, FI: 0.255, FR: 0.2, DE: 0.19, GR: 0.24, HU: 0.27,
  IE: 0.23, IT: 0.22, LV: 0.21, LT: 0.21, LU: 0.17, MT: 0.18, NL: 0.21, PL: 0.23, PT: 0.23, RO: 0.21, SK: 0.23, SI: 0.22, ES: 0.21, SE: 0.25,
};

/** VAT charged on a sale to `countryCode`: the Polish rate at home, the destination rate in the EU (OSS), none outside it. */
export function vatRateFor(countryCode: string | null | undefined, vat: { defaultVatRate?: number; ossRates?: Record<string, number> }): number {
  const country = (countryCode || 'PL').toUpperCase();
  if (country === 'PL') return vat.defaultVatRate ?? 0.23;
  return vat.ossRates?.[country] ?? EU_STANDARD_VAT[country] ?? 0;
}

export interface EconomicsItem {
  id: string;
  productId: string | null;
  quantity: number;
  unitPrice: number;
  /** Discount on the whole line, in the order currency. */
  discount: number;
  /** Landed unit cost in PLN on the order day; null when unknown. */
  unitCost: number | null;
}

export interface EconomicsFee {
  itemId: string | null;
  kind: FeeKind;
  /** Gross amount in PLN (VAT included). */
  amount: number;
  /** VAT in `amount` in PLN, when the provider says (0 = no VAT). */
  tax: number | null;
}

export interface EconomicsRefund {
  itemId: string | null;
  /** In PLN, VAT included. */
  amount: number;
  quantity: number | null;
  restocked: boolean;
}

export interface EconomicsShipment {
  carrier: 'inpost' | 'allegro_shipping';
  service: string;
}

export interface EconomicsInput {
  marketplace: 'shopify' | 'allegro' | 'empik' | 'vonhalsky';
  /** PLN per unit of the order currency. */
  fxRate: number;
  vatRate: number;
  /** Shipping the buyer paid, order currency, VAT included. */
  shippingAmount: number;
  items: EconomicsItem[];
  fees: EconomicsFee[];
  refunds: EconomicsRefund[];
  shipments: EconomicsShipment[];
  settings: Required<AnalyticsSettings>;
  /** VAT rate deducted from fees that report no VAT of their own. */
  feeVatRate: number;
}

export interface LineEconomics {
  itemId: string;
  quantity: number;
  refundedQuantity: number;
  gross: number;
  net: number;
  discount: number;
  fees: number;
  feesEstimated: boolean;
  cost: number;
  costKnown: boolean;
  shipping: number;
  delivery: number;
  refunds: number;
  profit: number;
}

const round = (n: number) => Math.round(n * 100) / 100;

/** Spreads `total` over lines in proportion to `weights` (equally when all weights are 0). */
export function allocate(total: number, weights: number[]): number[] {
  if (!weights.length) return [];
  const sum = weights.reduce((a, b) => a + b, 0);
  return weights.map((w) => (sum > 0 ? (total * w) / sum : total / weights.length));
}

/** Fees reported with their VAT count without it; fees without a VAT figure lose `feeVatRate` when deductible. */
function netFee(fee: EconomicsFee, deductible: boolean, feeVatRate: number): number {
  if (fee.tax !== null) return fee.amount - (deductible ? fee.tax : 0);
  return deductible ? fee.amount / (1 + feeVatRate) : fee.amount;
}

/** Marketplaces whose fallback commission is invoiced with Polish VAT (Shopify payment fees carry none). */
const VAT_INVOICED_FEES = new Set(['allegro', 'empik', 'vonhalsky']);

export function orderEconomics(input: EconomicsInput): LineEconomics[] {
  const { items, settings: s, fxRate, vatRate } = input;
  if (!items.length) return [];
  const gross = items.map((i) => Math.max(0, i.unitPrice * i.quantity - i.discount) * fxRate);
  const lines = items.map((item, n) => ({ item, gross: gross[n], fees: 0, delivery: 0, refunds: 0, refundedQuantity: 0 }));
  const byId = new Map(lines.map((l) => [l.item.id, l]));
  const spread = (total: number, key: 'fees' | 'delivery' | 'refunds') =>
    allocate(total, gross).forEach((share, n) => (lines[n][key] += share));

  // Fees: delivery charges count as delivery; everything else as fees. Only what the marketplace
  // reports, or the fallback commission when it reported nothing at all.
  const charges = input.fees.filter((f) => f.kind !== 'delivery');
  const deliveryCharges = input.fees.filter((f) => f.kind === 'delivery');
  const feesEstimated = input.fees.length === 0;
  if (feesEstimated) {
    const rate = s.fallbackCommission[input.marketplace] ?? 0;
    const deductible = s.feesVatDeductible && VAT_INVOICED_FEES.has(input.marketplace);
    lines.forEach((l) => (l.fees = (l.gross * rate) / (deductible ? 1 + input.feeVatRate : 1)));
  } else {
    let shared = 0;
    for (const f of charges) {
      const amount = netFee(f, s.feesVatDeductible, input.feeVatRate);
      const line = f.itemId ? byId.get(f.itemId) : undefined;
      if (line) line.fees += amount;
      else shared += amount;
    }
    spread(shared, 'fees');
  }

  // Delivery: our labels, the marketplace's delivery charges, packaging. A label bought through
  // Allegro Delivery is billed by Allegro, so its charge replaces the configured label cost.
  const marketplaceDelivery = deliveryCharges.reduce((sum, f) => sum + netFee(f, s.feesVatDeductible, input.feeVatRate), 0);
  let labels = 0;
  for (const shipment of input.shipments) {
    if (shipment.carrier === 'allegro_shipping') {
      if (!deliveryCharges.length) labels += s.labelCosts.allegro_shipping ?? s.defaultLabelCost;
    } else labels += s.labelCosts[shipment.service] ?? s.defaultLabelCost;
  }
  // Shipped outside Luora (or not yet): one parcel at the default cost, unless the marketplace billed delivery.
  if (!input.shipments.length && !deliveryCharges.length) labels += s.defaultLabelCost;
  spread(marketplaceDelivery + labels + s.packagingCost, 'delivery');

  // Refunds: back without VAT; goods that return to stock give their cost back.
  let sharedRefunds = 0;
  for (const r of input.refunds) {
    const line = r.itemId ? byId.get(r.itemId) : undefined;
    const back = r.amount / (1 + vatRate);
    if (!line) {
      sharedRefunds += back;
      continue;
    }
    line.refunds += back;
    if (r.quantity) {
      line.refundedQuantity += r.quantity;
      if (r.restocked && line.item.unitCost !== null) line.refunds -= r.quantity * line.item.unitCost;
    }
  }
  spread(sharedRefunds, 'refunds');

  const shipping = allocate((input.shippingAmount * fxRate) / (1 + vatRate), gross);
  return lines.map((l, n) => {
    const net = l.gross / (1 + vatRate);
    const cost = (l.item.unitCost ?? 0) * l.item.quantity;
    const profit = net - l.fees - cost + shipping[n] - l.delivery - l.refunds;
    return {
      itemId: l.item.id,
      quantity: l.item.quantity,
      refundedQuantity: Math.min(l.refundedQuantity, l.item.quantity),
      gross: round(l.gross),
      net: round(net),
      discount: round(l.item.discount * fxRate),
      fees: round(l.fees),
      feesEstimated,
      cost: round(cost),
      costKnown: l.item.unitCost !== null,
      shipping: round(shipping[n]),
      delivery: round(l.delivery),
      refunds: round(l.refunds),
      profit: round(profit),
    };
  });
}
