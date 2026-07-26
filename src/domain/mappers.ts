/**
 * Raw payload → domain model. The only place in the app that knows what the
 * spreadsheet looks like.
 */

import type { RawProductCost, RawTransaction } from './api'
import { toDate, toNumber, toNumberOr, toText } from './parse'
import { cleanSkuLabel, primarySku, skuKey } from './sku'
import type { Channel, Currency, Order, ProductCost } from './types'

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

export function mapTransaction(raw: RawTransaction, index: number): Order {
  const rawSku = toText(raw.sku)
  const label = cleanSkuLabel(primarySku(rawSku))
  const revenuePLN = toNumber(raw.pricePLN)
  const marginPLN = toNumber(raw.margin)

  return {
    id: `order-${index}`,
    rawSku,
    productKey: skuKey(primarySku(rawSku)),
    productLabel: label || 'Unnamed product',
    qty: toNumberOr(raw.qty, 1),
    currency: toCurrency(raw.currency),
    priceOriginal: toNumberOr(raw.price, 0),
    netPriceOriginal: toNumberOr(raw.netPrice, 0),
    commissionOriginal: toNumberOr(raw.commission, 0),
    shipmentOriginal: toNumberOr(raw.shipment, 0),
    revenuePLN: revenuePLN ?? 0,
    marginPLN: marginPLN ?? 0,
    marginPct: revenuePLN && revenuePLN !== 0 && marginPLN !== null ? (marginPLN / revenuePLN) * 100 : null,
    customerName: toText(raw.customerName),
    source: toChannel(raw.source),
    date: toDate(raw.date),
    // A row is only trustworthy when both PLN figures survived parsing.
    isComplete: revenuePLN !== null && marginPLN !== null,
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
