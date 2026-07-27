/**
 * Order assembly and product taxonomy.
 *
 * The sheet stores one row per product line. A customer who buys three items in
 * one basket produces three rows sharing a customer name and timestamp — so
 * counting rows as orders overstated volume by 6.9% and made average basket
 * value meaningless. Lines are grouped back into orders here, once, before any
 * metric is computed.
 */

import { ratio, sum } from './parse'
import type { LineItem, Order } from './types'

/**
 * Lines belong to the same order when the same customer transacted at the same
 * instant. Marketplace exports carry no order id, and a shared second-level
 * timestamp across one customer is not a coincidence.
 */
export function orderKeyFor(customerName: string, date: Date | null): string {
  return `${customerName.trim().toLowerCase()}|${date ? date.toISOString() : 'undated'}`
}

/**
 * Removes unprocessed duplicates within an order.
 *
 * A freshly placed order briefly appears twice: once fully calculated, once as
 * a placeholder whose formula columns are still blank. Grouped naively, that
 * pair reads as a two-product basket with no profit. A blank line is dropped
 * only when a fully-parsed line for the same product at the same price exists
 * beside it — a genuinely unprocessed order is kept and flagged, not hidden.
 */
function dropPlaceholderDuplicates(items: readonly LineItem[]): LineItem[] {
  if (items.length < 2) return [...items]
  const complete = items.filter((item) => item.isComplete)
  if (complete.length === 0) return [...items]

  return items.filter((item) => {
    if (item.isComplete) return true
    const hasTwin = complete.some(
      (other) =>
        other.productKey === item.productKey && other.priceOriginal === item.priceOriginal,
    )
    return !hasTwin
  })
}

export function buildOrders(lineItems: readonly LineItem[]): Order[] {
  const groups = new Map<string, LineItem[]>()
  for (const item of lineItems) {
    const existing = groups.get(item.orderKey)
    if (existing) existing.push(item)
    else groups.set(item.orderKey, [item])
  }

  const orders: Order[] = []
  for (const [key, rawItems] of groups) {
    const items = dropPlaceholderDuplicates(rawItems)
    const first = items[0]
    if (!first) continue

    const revenue = sum(items, (item) => item.revenuePLN)
    const margin = sum(items, (item) => item.marginPLN)

    orders.push({
      id: key,
      date: first.date,
      customerName: first.customerName,
      source: first.source,
      items,
      lineCount: items.length,
      units: sum(items, (item) => item.qty),
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: revenue > 0 ? (margin / revenue) * 100 : null,
      commissionPLN: sum(items, (item) => item.commissionPLN),
      shipmentPLN: sum(items, (item) => item.shipmentPLN),
      isComplete: items.every((item) => item.isComplete),
    })
  }

  return orders.sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
}

/** Average basket value across a set of orders. */
export function averageOrderValue(orders: readonly Order[]): number {
  return ratio(sum(orders, (order) => order.revenuePLN), orders.length)
}

/**
 * Brands present in the catalogue, longest first so that multi-word brands win
 * over any single-word prefix they contain.
 */
const BRANDS = [
  'Dr. Jart+',
  'Dr.Jart+',
  'CENTALLIAN24',
  'CENTELLIAN24',
  'Centellian24',
  'SKIN1004',
  'VT Cosmetics',
  'Round Lab',
  'ROUND LAB',
  'Numbuzin',
  'Arencia',
  'Medicube',
  'Isntree',
  'Purito',
  'Cosrx',
  'COSRX',
  'Anua',
  'ANUA',
  'Kopher',
  'KOPHER',
  'VT',
].sort((a, b) => b.length - a.length)

const BRAND_ALIASES: Record<string, string> = {
  'dr.jart+': 'Dr. Jart+',
  'dr. jart+': 'Dr. Jart+',
  centallian24: 'Centellian24',
  centellian24: 'Centellian24',
  'round lab': 'Round Lab',
  cosrx: 'COSRX',
  anua: 'Anua',
  'vt cosmetics': 'VT Cosmetics',
  vt: 'VT Cosmetics',
  kopher: 'KOPHER',
}

/** Infer the brand from a listing title. Titles lead with it often enough. */
export function inferBrand(label: string): string {
  const haystack = label.toLowerCase()
  for (const brand of BRANDS) {
    if (haystack.includes(brand.toLowerCase())) {
      return BRAND_ALIASES[brand.toLowerCase()] ?? brand
    }
  }
  return 'Other'
}

/**
 * Category rules run in priority order — a "sun serum" is sun care first,
 * because that is how a founder plans buying and promotion.
 */
const CATEGORY_RULES: Array<{ category: string; pattern: RegExp }> = [
  { category: 'Sun care', pattern: /\bspf|sunscreen|sun stick|sun serum|przeciwsłonecz/i },
  { category: 'Eye care', pattern: /\beye\b|pod oczy|oczu|eye cream|eye lifter/i },
  { category: 'Serums', pattern: /serum|ampoule|ampułk|essence|booster shot/i },
  { category: 'Moisturisers', pattern: /cream|krem|balsam|moisturi|nawilżaj|lotion/i },
  { category: 'Cleansers', pattern: /cleans|foam|pianka|oczyszczaj|tonik|toner/i },
  { category: 'Masks', pattern: /mask|maska|patch|płatki/i },
  { category: 'Devices', pattern: /device|urządzenie|age-r|booster pro/i },
]

export function inferCategory(label: string): string {
  for (const rule of CATEGORY_RULES) {
    if (rule.pattern.test(label)) return rule.category
  }
  return 'Other'
}
