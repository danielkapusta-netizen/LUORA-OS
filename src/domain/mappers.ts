/**
 * Raw payload → domain model. The only place in the app that knows what the
 * spreadsheet looks like.
 */

import type { RawProductCost, RawTransaction } from './api'
import { orderKeyFor } from './orders'
import { toDate, toNumber, toNumberOr, toText } from './parse'
import { cleanSkuLabel, primarySku, resolveCostKey, skuKey } from './sku'
import type { Channel, Currency, LineItem, ProductCost } from './types'

const KNOWN_CURRENCIES: readonly string[] = ['PLN', 'EUR', 'CZK', 'HUF']

function toCurrency(value: unknown): Currency {
  const text = toText(value).toUpperCase()
  return (KNOWN_CURRENCIES.includes(text) ? text : 'PLN') as Currency
}

function toChannel(value: unknown): Channel {
  // The backend guarantees `allegro` | `empik`; anything else still renders
  // faithfully rather than being silently reassigned to a real channel.
  return toText(value).toLowerCase() as Channel
}

export function mapTransaction(raw: RawTransaction, index: number): LineItem {
  const rawSku = toText(raw.sku)
  const label = cleanSkuLabel(primarySku(rawSku))
  const qty = toNumberOr(raw.qty, 1)

  // `pricePLN` (column M) is the line total — it already accounts for qty, so
  // a 4-unit line and a 1-unit line of the same product show 4x the price, not
  // the same price. Multiplying it by qty again would double-count revenue on
  // every multi-unit line. `price` (original currency) is the same line total,
  // just not yet converted.
  //
  // `netPrice` and `commission`, however, are still per unit — verified
  // directly: their ratio between a qty=1 and a qty=4 line of the same product
  // and price stays at 1.00, not 4.00. Those two still need the multiplication
  // that revenue no longer does.
  const revenuePLN = toNumber(raw.pricePLN)
  const priceOriginal = toNumberOr(raw.price, 0)
  const unitNetPriceOriginal = toNumberOr(raw.netPrice, 0)
  const unitCommissionOriginal = toNumberOr(raw.commission, 0)
  const netPriceOriginal = unitNetPriceOriginal * qty
  const commissionOriginal = unitCommissionOriginal * qty

  // Shipping is charged once per parcel, not per unit inside it — a 4-unit
  // line does not pay 4x the shipping of a 1-unit line — so it is read as-is.
  const shipmentOriginal = toNumberOr(raw.shipment, 0)

  // The sheet converts only price, and both sides of this ratio are now line
  // totals, so qty cancels out correctly — unlike a unit-price ÷ line-price
  // ratio, which would have been inflated by qty.
  const fxRate = priceOriginal !== 0 && revenuePLN !== null ? revenuePLN / priceOriginal : 1

  const customerName = toText(raw.customerName)
  const date = toDate(raw.date)

  // The sheet's own `margin` column inherited the same qty oversight revenue
  // just had, but asymmetrically: it nets a line-total revenue against a
  // per-unit cost basis, so on a multi-unit line it credits the extra units'
  // full revenue as pure profit. Checked directly against matched pairs of the
  // same product at qty=1 vs qty>1, the resulting ratio is not a clean qty
  // multiple (it ranges from -2x to 11x across products) — it cannot be
  // trusted for any line where qty > 1. `marginPLN` is therefore left
  // unset here and recomputed in `applyLandedCostMargin` once each line can be
  // matched to its own landed cost, which is qty-aware by construction
  // (unit cost × qty) and does not carry this fault.
  return {
    id: `line-${index}`,
    rawSku,
    productKey: skuKey(primarySku(rawSku)),
    productLabel: label || 'Unnamed product',
    qty,
    currency: toCurrency(raw.currency),
    priceOriginal,
    netPriceOriginal,
    commissionOriginal,
    shipmentOriginal,
    fxRate,
    revenuePLN: revenuePLN ?? 0,
    commissionPLN: commissionOriginal * fxRate,
    shipmentPLN: shipmentOriginal * fxRate,
    marginPLN: 0,
    marginPct: null,
    customerName,
    source: toChannel(raw.source),
    date,
    // A row is only trustworthy when its PLN price survived parsing; margin
    // completeness is folded in once `applyLandedCostMargin` has run.
    isComplete: revenuePLN !== null,
    orderKey: orderKeyFor(customerName, date),
  }
}

/**
 * Recomputes margin from first principles: revenue minus marketplace
 * commission, shipping, and landed product cost.
 *
 * This replaces the sheet's own `margin` column rather than adjusting it,
 * because that column is not merely unscaled for qty — it is netting a
 * correctly-scaled revenue against a not-scaled cost basis, which inflates
 * profit on every multi-unit line by an inconsistent amount. Recomputing from
 * commission (already qty-correct here) and landed cost (qty-aware by
 * construction) is the only version of this figure that is safe to trust.
 *
 * When a line's product has no landed cost on file, margin falls back to
 * revenue minus commission and shipping only — the same "unverified, likely
 * overstated" treatment already applied everywhere a landed cost is missing,
 * and already surfaced via `costUnknown` / the cost-coverage insight.
 */
export function applyLandedCostMargin(
  lineItems: readonly LineItem[],
  costs: readonly ProductCost[],
): LineItem[] {
  const costIndex = new Map<string, ProductCost>()
  for (const cost of costs) {
    if (cost.productKey) costIndex.set(cost.productKey, cost)
  }

  return lineItems.map((line) => {
    const costKey = resolveCostKey(line.rawSku, costIndex)
    const unitCostPLN = costKey ? (costIndex.get(costKey)?.totalCostPLN ?? null) : null
    const landedCostPLN = unitCostPLN !== null ? unitCostPLN * line.qty : 0

    const marginPLN = line.revenuePLN - line.commissionPLN - line.shipmentPLN - landedCostPLN
    const marginPct = line.revenuePLN !== 0 ? (marginPLN / line.revenuePLN) * 100 : null

    return { ...line, marginPLN, marginPct }
  })
}

export function mapProductCost(raw: RawProductCost): ProductCost {
  const rawSku = toText(raw.sku)
  return {
    rawSku,
    productKey: skuKey(rawSku),
    productLabel: cleanSkuLabel(rawSku) || 'Unnamed product',
    totalCostPLN: toNumber(raw.totalCost),
    costEUR: toNumber(raw.costEUR),
    costUSD: toNumber(raw.costUSD),
    costPLN: toNumber(raw.costPLN),
    shipmentUSD: toNumber(raw.shipmentUSD),
    higherMoq: toNumber(raw.higherMoq),
  }
}
