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
  const revenuePLN = toNumber(raw.pricePLN)
  const marginPLN = toNumber(raw.margin)
  const priceOriginal = toNumberOr(raw.price, 0)

  // The sheet converts only price. Everything else reaches PLN through the
  // rate implied by that one conversion.
  const fxRate = priceOriginal !== 0 && revenuePLN !== null ? revenuePLN / priceOriginal : 1
  const commissionOriginal = toNumberOr(raw.commission, 0)
  const shipmentOriginal = toNumberOr(raw.shipment, 0)

  const customerName = toText(raw.customerName)
  const date = toDate(raw.date)

  return {
    id: `line-${index}`,
    rawSku,
    productKey: skuKey(primarySku(rawSku)),
    productLabel: label || 'Unnamed product',
    qty: toNumberOr(raw.qty, 1),
    currency: toCurrency(raw.currency),
    priceOriginal,
    netPriceOriginal: toNumberOr(raw.netPrice, 0),
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
