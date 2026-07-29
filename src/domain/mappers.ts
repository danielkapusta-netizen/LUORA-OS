/**
 * Raw payload → domain model. The only place in the app that knows what the
 * spreadsheet looks like.
 *
 * The source sheet's per-line fields have changed shape twice in the course of
 * this project, each time silently: first `pricePLN` went from per-unit to a
 * qty-scaled line total; more recently `commission` and `margin` followed suit.
 * `netPrice` alone remains per-unit. None of this is announced by the API — it
 * is only detectable by comparing matched qty=1 and qty>1 rows of the same
 * product — so if a figure here ever looks wrong again, that comparison is the
 * first thing to redo, not an assumption to trust from this comment.
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

  // `pricePLN`, `price`, `commission` and `margin` are all line totals: a
  // qty=4 row shows exactly 4x the value of a qty=1 row of the same product,
  // verified directly across dozens of matched pairs. None of these four are
  // multiplied by qty here — doing so would double-count exactly as it did
  // when only `pricePLN` had been fixed and this code still scaled it again.
  const revenuePLN = toNumber(raw.pricePLN)
  const marginPLN = toNumber(raw.margin)
  const priceOriginal = toNumberOr(raw.price, 0)
  const commissionOriginal = toNumberOr(raw.commission, 0)

  // `netPrice` is the one holdout still reported per unit — its ratio between
  // a qty=1 and a qty=4 row of the same product stays at 1.00, not 4.00.
  const netPriceOriginal = toNumberOr(raw.netPrice, 0) * qty

  // Shipping is charged once per parcel, not per unit inside it — a 4-unit
  // line does not pay 4x the shipping of a 1-unit line — so it is read as-is.
  // (Checked: its ratio across matched pairs is noisy, not a clean multiple.)
  const shipmentOriginal = toNumberOr(raw.shipment, 0)

  // The sheet converts only price. Revenue and price are both line totals now,
  // so qty cancels out of the ratio and this is still a clean per-currency rate.
  const fxRate = priceOriginal !== 0 && revenuePLN !== null ? revenuePLN / priceOriginal : 1

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
    netPriceOriginal,
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
