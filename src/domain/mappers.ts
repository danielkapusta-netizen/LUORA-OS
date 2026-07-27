/**
 * Raw payload → domain model. The only place in the app that knows what the
 * spreadsheet looks like.
 */

import type { RawProductCost, RawTransaction } from './api'
import { orderKeyFor } from './orders'
import { toDate, toNumber, toNumberOr, toText } from './parse'
import { cleanSkuLabel, primarySku, skuKey } from './sku'
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

  // `price`, `pricePLN`, `netPrice`, `commission` and `margin` are computed
  // per unit in the source sheet regardless of the qty column — a 4-unit
  // order shows the same price as a 1-unit order of the same product. Left
  // unscaled, this undercounts all-time revenue by ~6% and profit further
  // still, concentrated in the 6% of rows where qty > 1. Multiplying by qty
  // here is the one place that correction needs to happen.
  const unitRevenuePLN = toNumber(raw.pricePLN)
  const unitMarginPLN = toNumber(raw.margin)
  const unitPriceOriginal = toNumberOr(raw.price, 0)
  const unitCommissionOriginal = toNumberOr(raw.commission, 0)

  const revenuePLN = unitRevenuePLN !== null ? unitRevenuePLN * qty : null
  const marginPLN = unitMarginPLN !== null ? unitMarginPLN * qty : null
  const priceOriginal = unitPriceOriginal * qty
  const commissionOriginal = unitCommissionOriginal * qty

  // Shipping is charged once per parcel, not per unit inside it — a 4-unit
  // line does not pay 4x the shipping of a 1-unit line — so it is read as-is.
  const shipmentOriginal = toNumberOr(raw.shipment, 0)

  // The sheet converts only price. Everything else reaches PLN through the
  // rate implied by that one conversion (qty cancels out of the ratio).
  const fxRate = unitPriceOriginal !== 0 && unitRevenuePLN !== null ? unitRevenuePLN / unitPriceOriginal : 1

  const customerName = toText(raw.customerName)
  const date = toDate(raw.date)

  return {
    id: `line-${index}`,
    rawSku,
    productKey: skuKey(primarySku(rawSku)),
    productLabel: label || 'Unnamed product',
    qty,
    currency: toCurrency(raw.currency),
    priceOriginal,
    netPriceOriginal: toNumberOr(raw.netPrice, 0) * qty,
    commissionOriginal,
    shipmentOriginal,
    fxRate,
    revenuePLN: revenuePLN ?? 0,
    commissionPLN: commissionOriginal * fxRate,
    shipmentPLN: shipmentOriginal * fxRate,
    marginPLN: marginPLN ?? 0,
    marginPct:
      revenuePLN && revenuePLN !== 0 && marginPLN !== null ? (marginPLN / revenuePLN) * 100 : null,
    customerName,
    source: toChannel(raw.source),
    date,
    // A row is only trustworthy when both PLN figures survived parsing.
    isComplete: revenuePLN !== null && marginPLN !== null,
    orderKey: orderKeyFor(customerName, date),
  }
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
