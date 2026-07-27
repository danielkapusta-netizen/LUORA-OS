/**
 * Aggregation engine. Pure functions over the domain model — no React, no
 * formatting, no presentation concerns. Everything here could be lifted into
 * Apps Script unchanged if these calculations ever move server-side.
 *
 * All volume metrics count **orders**, not line items. Product metrics count
 * the orders a product appeared in, so a three-item basket contributes one
 * order to each of its three products but only one to company volume.
 */

import { inferBrand, inferCategory } from './orders'
import { bucketKey, isWithin, nextBucket } from './period'
import { ratio, sum, toIsoDay } from './parse'
import { resolveCostKey } from './sku'
import type {
  Channel,
  ChannelPerformance,
  DailyPoint,
  DataCoverage,
  Granularity,
  LineItem,
  Order,
  PeriodComparison,
  PeriodTotals,
  ProductCost,
  ProductPerformance,
} from './types'

/** Longest comparison window we will ever use, even with years of history. */
const MAX_WINDOW_DAYS = 7
/** Below this many trading days a period-over-period read is not honest. */
const MIN_DAYS_FOR_COMPARISON = 4

export function buildCostIndex(costs: readonly ProductCost[]): Map<string, ProductCost> {
  const index = new Map<string, ProductCost>()
  for (const cost of costs) {
    if (cost.productKey) index.set(cost.productKey, cost)
  }
  return index
}

/** Filter orders to a window. */
export function ordersWithin(orders: readonly Order[], from: Date, to: Date): Order[] {
  return orders.filter((order) => isWithin(order.date, from, to))
}

/** Every line item belonging to the given orders. */
export function linesOf(orders: readonly Order[]): LineItem[] {
  return orders.flatMap((order) => order.items)
}

/**
 * Time series across the full span at the requested grain, including buckets
 * with no trading. Gaps are represented as real zeros rather than skipped, so a
 * quiet Sunday reads as a quiet Sunday instead of vanishing from the chart.
 */
export function buildSeries(
  orders: readonly Order[],
  granularity: Granularity,
  range?: { from: Date; to: Date },
): DailyPoint[] {
  const dated = orders.filter((order) => order.date !== null)
  if (dated.length === 0 && !range) return []

  const buckets = new Map<string, { orders: number; units: number; revenue: number; margin: number }>()
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const order of dated) {
    const time = order.date!.getTime()
    if (time < min) min = time
    if (time > max) max = time

    const key = bucketKey(order.date!, granularity)
    const bucket = buckets.get(key) ?? { orders: 0, units: 0, revenue: 0, margin: 0 }
    bucket.orders += 1
    bucket.units += order.units
    bucket.revenue += order.revenuePLN
    bucket.margin += order.marginPLN
    buckets.set(key, bucket)
  }

  const start = range ? range.from : new Date(min)
  const end = range ? range.to : new Date(max)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return []

  const series: DailyPoint[] = []
  let cursor = new Date(`${bucketKey(start, granularity)}T00:00:00Z`)
  const limit = end.getTime()
  let guard = 0

  while (cursor.getTime() <= limit && guard < 5000) {
    const key = toIsoDay(cursor)
    const bucket = buckets.get(key)
    const revenue = bucket?.revenue ?? 0
    const margin = bucket?.margin ?? 0
    const orderCount = bucket?.orders ?? 0
    series.push({
      date: key,
      orders: orderCount,
      units: bucket?.units ?? 0,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
      avgOrderValuePLN: ratio(revenue, orderCount),
    })
    cursor = nextBucket(cursor, granularity)
    guard += 1
  }

  return series
}

export function buildProductPerformance(
  orders: readonly Order[],
  costs: readonly ProductCost[],
): ProductPerformance[] {
  const costIndex = buildCostIndex(costs)
  const lines = linesOf(orders)
  const totalRevenue = sum(lines, (line) => line.revenuePLN)
  const totalMargin = sum(lines, (line) => line.marginPLN)

  const groups = new Map<string, { lines: LineItem[]; orderIds: Set<string> }>()
  for (const order of orders) {
    for (const line of order.items) {
      const existing = groups.get(line.productKey)
      if (existing) {
        existing.lines.push(line)
        existing.orderIds.add(order.id)
      } else {
        groups.set(line.productKey, { lines: [line], orderIds: new Set([order.id]) })
      }
    }
  }

  const products: ProductPerformance[] = []
  for (const [productKey, group] of groups) {
    const first = group.lines[0]
    if (!first) continue

    const revenue = sum(group.lines, (line) => line.revenuePLN)
    const margin = sum(group.lines, (line) => line.marginPLN)
    const units = sum(group.lines, (line) => line.qty)
    const orderCount = group.orderIds.size

    const costKey = resolveCostKey(first.rawSku, costIndex)
    const cost = costKey ? costIndex.get(costKey) : undefined

    const times = group.lines
      .map((line) => line.date)
      .filter((date): date is Date => date !== null)
      .map((date) => date.getTime())

    products.push({
      productKey,
      label: first.productLabel,
      brand: inferBrand(first.productLabel),
      category: inferCategory(first.productLabel),
      orders: orderCount,
      units,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
      revenueShare: ratio(revenue, totalRevenue),
      marginShare: ratio(margin, totalMargin),
      avgOrderValuePLN: ratio(revenue, orderCount),
      avgUnitPricePLN: ratio(revenue, units),
      unitCostPLN: cost?.totalCostPLN ?? null,
      costUnknown: cost === undefined,
      channels: [...new Set(group.lines.map((line) => line.source))],
      firstSold: times.length ? new Date(Math.min(...times)) : null,
      lastSold: times.length ? new Date(Math.max(...times)) : null,
    })
  }

  return products.sort((a, b) => b.revenuePLN - a.revenuePLN)
}

export function buildChannelPerformance(orders: readonly Order[]): ChannelPerformance[] {
  const totalRevenue = sum(orders, (order) => order.revenuePLN)
  const groups = new Map<Channel, Order[]>()

  for (const order of orders) {
    const existing = groups.get(order.source)
    if (existing) existing.push(order)
    else groups.set(order.source, [order])
  }

  const channels: ChannelPerformance[] = []
  for (const [source, group] of groups) {
    const revenue = sum(group, (order) => order.revenuePLN)
    const margin = sum(group, (order) => order.marginPLN)
    channels.push({
      source,
      orders: group.length,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
      revenueShare: ratio(revenue, totalRevenue),
      avgOrderValuePLN: ratio(revenue, group.length),
    })
  }

  return channels.sort((a, b) => b.revenuePLN - a.revenuePLN)
}

function totalsFor(points: readonly DailyPoint[]): PeriodTotals {
  const revenue = sum(points, (point) => point.revenuePLN)
  const margin = sum(points, (point) => point.marginPLN)
  return {
    from: points[0]?.date ?? '',
    to: points[points.length - 1]?.date ?? '',
    orders: sum(points, (point) => point.orders),
    revenuePLN: revenue,
    marginPLN: margin,
    marginPct: ratio(margin, revenue) * 100,
  }
}

/**
 * Like-for-like comparison of the two most recent equal-length windows, used
 * where no explicit period is selected. The window adapts to the history
 * available and flags itself unreliable when there is too little.
 */
export function buildComparison(daily: readonly DailyPoint[]): PeriodComparison {
  const available = daily.length
  const windowDays = Math.max(1, Math.min(MAX_WINDOW_DAYS, Math.floor(available / 2)))

  const current = daily.slice(available - windowDays)
  const previous = daily.slice(Math.max(0, available - windowDays * 2), available - windowDays)

  const currentTotals = totalsFor(current)
  const previousTotals = totalsFor(previous)

  const change = (now: number, before: number): number | null =>
    before === 0 ? null : ((now - before) / Math.abs(before)) * 100

  return {
    windowDays,
    current: currentTotals,
    previous: previousTotals,
    revenueChangePct: change(currentTotals.revenuePLN, previousTotals.revenuePLN),
    marginChangePct: change(currentTotals.marginPLN, previousTotals.marginPLN),
    ordersChangePct: change(currentTotals.orders, previousTotals.orders),
    isReliable: available >= MIN_DAYS_FOR_COMPARISON && previous.length === windowDays,
  }
}

/**
 * How much of the reported profit we can actually stand behind.
 *
 * Lines whose product has no cost record still report a margin, but that margin
 * excludes COGS and is therefore overstated. Quantifying that exposure is the
 * difference between a dashboard and a decision tool.
 */
export function buildCoverage(
  orders: readonly Order[],
  costs: readonly ProductCost[],
): DataCoverage {
  const costIndex = buildCostIndex(costs)
  const lines = linesOf(orders)
  const missing = lines.filter((line) => resolveCostKey(line.rawSku, costIndex) === null)
  const totalRevenue = sum(lines, (line) => line.revenuePLN)
  const missingRevenue = sum(missing, (line) => line.revenuePLN)

  const times = orders
    .map((order) => order.date)
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime())

  const uniqueDays = new Set(
    orders.filter((order) => order.date !== null).map((order) => toIsoDay(order.date!)),
  )

  return {
    totalOrders: orders.length,
    totalLineItems: lines.length,
    completeLineItems: lines.filter((line) => line.isComplete).length,
    linesMissingCost: missing.length,
    revenueMissingCostPLN: missingRevenue,
    costCoverage: totalRevenue > 0 ? 1 - missingRevenue / totalRevenue : 1,
    ordersWithMissingLine: orders.filter((order) => order.hasSuspectedMissingLine).length,
    firstOrder: times.length ? new Date(Math.min(...times)) : null,
    lastOrder: times.length ? new Date(Math.max(...times)) : null,
    tradingDays: uniqueDays.size,
  }
}
