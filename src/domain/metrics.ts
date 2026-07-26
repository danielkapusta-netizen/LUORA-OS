/**
 * Aggregation engine. Pure functions over the domain model — no React, no
 * formatting, no presentation concerns. Everything here could be lifted into
 * Apps Script unchanged if these calculations ever move server-side.
 */

import { ratio, sum, toIsoDay } from './parse'
import { resolveCostKey } from './sku'
import type {
  Channel,
  ChannelPerformance,
  DailyPoint,
  DataCoverage,
  Order,
  PeriodComparison,
  PeriodTotals,
  ProductCost,
  ProductPerformance,
} from './types'

const DAY_MS = 86_400_000
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

/**
 * Daily series across the full calendar span, including days with no trading.
 * Gaps are represented as real zeros rather than skipped, so a quiet Sunday
 * reads as a quiet Sunday instead of vanishing from the chart.
 */
export function buildDailySeries(orders: readonly Order[]): DailyPoint[] {
  const dated = orders.filter((order) => order.date !== null)
  if (dated.length === 0) return []

  const buckets = new Map<string, { orders: number; units: number; revenue: number; margin: number }>()
  let min = Number.POSITIVE_INFINITY
  let max = Number.NEGATIVE_INFINITY

  for (const order of dated) {
    const time = order.date!.getTime()
    if (time < min) min = time
    if (time > max) max = time

    const key = toIsoDay(order.date!)
    const bucket = buckets.get(key) ?? { orders: 0, units: 0, revenue: 0, margin: 0 }
    bucket.orders += 1
    bucket.units += order.qty
    bucket.revenue += order.revenuePLN
    bucket.margin += order.marginPLN
    buckets.set(key, bucket)
  }

  const series: DailyPoint[] = []
  const startDay = Date.UTC(
    new Date(min).getUTCFullYear(),
    new Date(min).getUTCMonth(),
    new Date(min).getUTCDate(),
  )
  const endDay = Date.UTC(
    new Date(max).getUTCFullYear(),
    new Date(max).getUTCMonth(),
    new Date(max).getUTCDate(),
  )

  for (let time = startDay; time <= endDay; time += DAY_MS) {
    const key = toIsoDay(new Date(time))
    const bucket = buckets.get(key)
    const revenue = bucket?.revenue ?? 0
    const margin = bucket?.margin ?? 0
    series.push({
      date: key,
      orders: bucket?.orders ?? 0,
      units: bucket?.units ?? 0,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
    })
  }

  return series
}

export function buildProductPerformance(
  orders: readonly Order[],
  costs: readonly ProductCost[],
): ProductPerformance[] {
  const costIndex = buildCostIndex(costs)
  const totalRevenue = sum(orders, (order) => order.revenuePLN)
  const totalMargin = sum(orders, (order) => order.marginPLN)

  const groups = new Map<string, Order[]>()
  for (const order of orders) {
    const existing = groups.get(order.productKey)
    if (existing) existing.push(order)
    else groups.set(order.productKey, [order])
  }

  const products: ProductPerformance[] = []
  for (const [productKey, group] of groups) {
    const first = group[0]
    if (!first) continue

    const revenue = sum(group, (order) => order.revenuePLN)
    const margin = sum(group, (order) => order.marginPLN)
    const units = sum(group, (order) => order.qty)

    const costKey = resolveCostKey(first.rawSku, costIndex)
    const cost = costKey ? costIndex.get(costKey) : undefined

    const dates = group.map((order) => order.date).filter((date): date is Date => date !== null)
    const times = dates.map((date) => date.getTime())

    products.push({
      productKey,
      label: first.productLabel,
      orders: group.length,
      units,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
      revenueShare: ratio(revenue, totalRevenue),
      marginShare: ratio(margin, totalMargin),
      avgOrderValuePLN: ratio(revenue, group.length),
      unitCostPLN: cost?.totalCostPLN ?? null,
      costUnknown: cost === undefined,
      channels: [...new Set(group.map((order) => order.source))],
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
 * Like-for-like comparison of the two most recent equal-length windows.
 *
 * The window adapts to the history available: with ten days of data a "last 7
 * days vs previous 7" read would compare seven days against three and overstate
 * growth. We halve the available span instead, and flag the result as
 * unreliable when there is not enough history to say anything at all.
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
 * Orders whose product has no cost record still report a margin, but that
 * margin excludes COGS and is therefore overstated. Quantifying that exposure
 * is the difference between a dashboard and a decision tool.
 */
export function buildCoverage(orders: readonly Order[], costs: readonly ProductCost[]): DataCoverage {
  const costIndex = buildCostIndex(costs)
  const missing = orders.filter((order) => resolveCostKey(order.rawSku, costIndex) === null)
  const totalRevenue = sum(orders, (order) => order.revenuePLN)
  const missingRevenue = sum(missing, (order) => order.revenuePLN)

  const times = orders
    .map((order) => order.date)
    .filter((date): date is Date => date !== null)
    .map((date) => date.getTime())

  const uniqueDays = new Set(
    orders
      .filter((order) => order.date !== null)
      .map((order) => toIsoDay(order.date!)),
  )

  return {
    totalOrders: orders.length,
    completeOrders: orders.filter((order) => order.isComplete).length,
    ordersMissingCost: missing.length,
    revenueMissingCostPLN: missingRevenue,
    costCoverage: totalRevenue > 0 ? 1 - missingRevenue / totalRevenue : 1,
    firstOrder: times.length ? new Date(Math.min(...times)) : null,
    lastOrder: times.length ? new Date(Math.max(...times)) : null,
    tradingDays: uniqueDays.size,
  }
}
