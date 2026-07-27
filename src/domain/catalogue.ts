/**
 * Catalogue roll-ups.
 *
 * The Products page examines the same trade at three altitudes — individual
 * listing, brand, and category. They share one shape so the table, the sorting
 * and the expanded panel are written once and the toggle is a data decision
 * rather than three parallel implementations.
 */

import { inferBrand, inferCategory } from './orders'
import { ratio, sum } from './parse'
import type { LineItem, Order, ProductPerformance } from './types'

export type CatalogueDimension = 'product' | 'brand' | 'category'

export interface CatalogueRow {
  /** Stable key for this row within its dimension. */
  key: string
  label: string
  /** Products rolled into this row — 1 for the product dimension. */
  memberCount: number
  orders: number
  units: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
  revenueShare: number
  marginShare: number
  avgOrderValuePLN: number
  avgUnitPricePLN: number
  /** True when any member lacks a landed cost, so profit is overstated. */
  costUnknown: boolean
  firstSold: Date | null
  lastSold: Date | null
  /** Underlying product keys, for drill-through into line-level detail. */
  productKeys: string[]
}

function labelFor(dimension: CatalogueDimension, line: LineItem): string {
  if (dimension === 'brand') return inferBrand(line.productLabel)
  if (dimension === 'category') return inferCategory(line.productLabel)
  return line.productLabel
}

function keyFor(dimension: CatalogueDimension, line: LineItem): string {
  return dimension === 'product' ? line.productKey : labelFor(dimension, line)
}

/**
 * Rolls orders up to the requested dimension.
 *
 * Order counts are de-duplicated per row: a basket containing two products of
 * the same brand is one order for that brand, not two. Summing product-level
 * order counts would double-count exactly the baskets that matter most.
 */
export function buildCatalogue(
  orders: readonly Order[],
  dimension: CatalogueDimension,
  products: readonly ProductPerformance[],
): CatalogueRow[] {
  const costUnknownByProduct = new Map(
    products.map((product) => [product.productKey, product.costUnknown]),
  )

  interface Bucket {
    label: string
    lines: LineItem[]
    orderIds: Set<string>
    productKeys: Set<string>
  }

  const buckets = new Map<string, Bucket>()

  for (const order of orders) {
    for (const line of order.items) {
      const key = keyFor(dimension, line)
      const existing = buckets.get(key)
      if (existing) {
        existing.lines.push(line)
        existing.orderIds.add(order.id)
        existing.productKeys.add(line.productKey)
      } else {
        buckets.set(key, {
          label: labelFor(dimension, line),
          lines: [line],
          orderIds: new Set([order.id]),
          productKeys: new Set([line.productKey]),
        })
      }
    }
  }

  const totalRevenue = sum(orders, (order) => order.revenuePLN)
  const totalMargin = sum(orders, (order) => order.marginPLN)

  const rows: CatalogueRow[] = []
  for (const [key, bucket] of buckets) {
    const revenue = sum(bucket.lines, (line) => line.revenuePLN)
    const margin = sum(bucket.lines, (line) => line.marginPLN)
    const units = sum(bucket.lines, (line) => line.qty)
    const times = bucket.lines
      .map((line) => line.date)
      .filter((date): date is Date => date !== null)
      .map((date) => date.getTime())

    rows.push({
      key,
      label: bucket.label,
      memberCount: bucket.productKeys.size,
      orders: bucket.orderIds.size,
      units,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
      revenueShare: ratio(revenue, totalRevenue),
      marginShare: ratio(margin, totalMargin),
      avgOrderValuePLN: ratio(revenue, bucket.orderIds.size),
      avgUnitPricePLN: ratio(revenue, units),
      costUnknown: [...bucket.productKeys].some(
        (productKey) => costUnknownByProduct.get(productKey) ?? false,
      ),
      firstSold: times.length ? new Date(Math.min(...times)) : null,
      lastSold: times.length ? new Date(Math.max(...times)) : null,
      productKeys: [...bucket.productKeys],
    })
  }

  return rows.sort((a, b) => b.revenuePLN - a.revenuePLN)
}

export interface CatalogueTrendPoint {
  date: string
  revenuePLN: number
  marginPLN: number
  marginPct: number
  units: number
  /** Average selling price per unit — the price history for this row. */
  avgUnitPricePLN: number
}

/**
 * Monthly history for one catalogue row: revenue, profit, margin rate and
 * realised unit price. Price history matters as much as revenue here — a
 * product whose margin is sliding usually shows it in average selling price
 * before it shows it anywhere else.
 */
export function buildCatalogueHistory(
  orders: readonly Order[],
  productKeys: readonly string[],
): CatalogueTrendPoint[] {
  const wanted = new Set(productKeys)
  const buckets = new Map<string, { revenue: number; margin: number; units: number }>()

  for (const order of orders) {
    if (!order.date) continue
    const month = order.date.toISOString().slice(0, 7)
    for (const line of order.items) {
      if (!wanted.has(line.productKey)) continue
      const bucket = buckets.get(month) ?? { revenue: 0, margin: 0, units: 0 }
      bucket.revenue += line.revenuePLN
      bucket.margin += line.marginPLN
      bucket.units += line.qty
      buckets.set(month, bucket)
    }
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, bucket]) => ({
      date: `${month}-01`,
      revenuePLN: bucket.revenue,
      marginPLN: bucket.margin,
      marginPct: ratio(bucket.margin, bucket.revenue) * 100,
      units: bucket.units,
      avgUnitPricePLN: ratio(bucket.revenue, bucket.units),
    }))
}

export type HealthGrade = 'excellent' | 'good' | 'watch' | 'poor'

export interface CatalogueHealth {
  score: number
  grade: HealthGrade
  /** Why the score is what it is, in one line. */
  summary: string
  factors: Array<{ label: string; detail: string; positive: boolean }>
}

/**
 * A per-row health score, built from the same principle as the business score:
 * every component is stated, so the number can be argued with.
 */
export function scoreCatalogueRow(
  row: CatalogueRow,
  portfolioMarginPct: number,
  history: readonly CatalogueTrendPoint[],
): CatalogueHealth {
  const factors: CatalogueHealth['factors'] = []
  let score = 50

  // Margin against the portfolio it belongs to.
  const marginGap = row.marginPct - portfolioMarginPct
  if (marginGap >= 10) {
    score += 25
    factors.push({
      label: 'Margin',
      detail: `${row.marginPct.toFixed(1)}% — well above the ${portfolioMarginPct.toFixed(1)}% portfolio average.`,
      positive: true,
    })
  } else if (marginGap >= 0) {
    score += 12
    factors.push({
      label: 'Margin',
      detail: `${row.marginPct.toFixed(1)}% — at or just above the portfolio average.`,
      positive: true,
    })
  } else if (marginGap >= -10) {
    score -= 10
    factors.push({
      label: 'Margin',
      detail: `${row.marginPct.toFixed(1)}% — below the ${portfolioMarginPct.toFixed(1)}% portfolio average.`,
      positive: false,
    })
  } else {
    score -= 25
    factors.push({
      label: 'Margin',
      detail: `${row.marginPct.toFixed(1)}% — far below the portfolio average, diluting overall profitability.`,
      positive: false,
    })
  }

  // Direction of travel across the last two months of history.
  if (history.length >= 2) {
    const latest = history[history.length - 1]!
    const prior = history[history.length - 2]!
    const marginShift = latest.marginPct - prior.marginPct
    if (marginShift <= -3) {
      score -= 15
      factors.push({
        label: 'Trend',
        detail: `Margin fell ${Math.abs(marginShift).toFixed(1)} points against last month.`,
        positive: false,
      })
    } else if (marginShift >= 3) {
      score += 12
      factors.push({
        label: 'Trend',
        detail: `Margin improved ${marginShift.toFixed(1)} points against last month.`,
        positive: true,
      })
    }

    const priceShift =
      prior.avgUnitPricePLN > 0
        ? ((latest.avgUnitPricePLN - prior.avgUnitPricePLN) / prior.avgUnitPricePLN) * 100
        : 0
    if (priceShift <= -5) {
      score -= 8
      factors.push({
        label: 'Price',
        detail: `Realised unit price dropped ${Math.abs(priceShift).toFixed(1)}% — discounting or a mix shift.`,
        positive: false,
      })
    }
  }

  // Weight in the book: a big row carries more consequence either way.
  if (row.revenueShare >= 0.1) {
    factors.push({
      label: 'Scale',
      detail: `${(row.revenueShare * 100).toFixed(1)}% of revenue — material to the business.`,
      positive: row.marginPct >= portfolioMarginPct,
    })
    score += row.marginPct >= portfolioMarginPct ? 8 : -8
  }

  if (row.costUnknown) {
    score -= 10
    factors.push({
      label: 'Data',
      detail: 'No landed cost on file, so the profit shown here is overstated.',
      positive: false,
    })
  }

  const clamped = Math.max(0, Math.min(100, Math.round(score)))
  const grade: HealthGrade =
    clamped >= 75 ? 'excellent' : clamped >= 58 ? 'good' : clamped >= 40 ? 'watch' : 'poor'

  const summary =
    grade === 'excellent'
      ? 'Earning well above the portfolio and holding it.'
      : grade === 'good'
        ? 'Pulling its weight, with room to push further.'
        : grade === 'watch'
          ? 'Trading, but not on terms that help the business.'
          : 'Losing money or close to it — needs a pricing or cost decision.'

  return { score: clamped, grade, summary, factors }
}
