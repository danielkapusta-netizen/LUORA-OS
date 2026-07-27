/**
 * The Business Snapshot: everything the UI knows, scoped to one period.
 *
 * A single period selection re-derives every figure on the page — KPIs, health,
 * insights, questions, series. Pages read a finished `Snapshot` and render it;
 * they never filter or aggregate. That is what keeps one selector authoritative
 * across the whole application instead of each page inventing its own scope.
 */

import { computeHealthScore } from './health'
import { generateInsights } from './insights'
import { averageOrderValue } from './orders'
import { ordersWithin, buildChannelPerformance, buildProductPerformance, buildSeries } from './metrics'
import type { ResolvedPeriod } from './period'
import { ratio, sum } from './parse'
import type {
  ChannelPerformance,
  DailyPoint,
  DataCoverage,
  HealthScore,
  Insight,
  Kpi,
  LineItem,
  Order,
  PeriodComparison,
  ProductCost,
  ProductPerformance,
} from './types'

/** Totals for one window, computed from orders rather than line items. */
export interface WindowTotals {
  orders: number
  lineItems: number
  units: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
  avgOrderValuePLN: number
  customers: number
}

export interface Snapshot {
  period: ResolvedPeriod
  /** Orders inside the period. */
  orders: Order[]
  /** Orders in the equal-length window immediately before. */
  previousOrders: Order[]
  lineItems: LineItem[]
  totals: WindowTotals
  previousTotals: WindowTotals | null
  kpis: Kpi[]
  series: DailyPoint[]
  products: ProductPerformance[]
  previousProducts: ProductPerformance[]
  channels: ChannelPerformance[]
  health: HealthScore
  insights: Insight[]
  /** True when the period contains no orders at all. */
  isEmpty: boolean
}

export function computeTotals(orders: readonly Order[]): WindowTotals {
  const lines = orders.flatMap((order) => order.items)
  const revenue = sum(orders, (order) => order.revenuePLN)
  const margin = sum(orders, (order) => order.marginPLN)
  return {
    orders: orders.length,
    lineItems: lines.length,
    units: sum(orders, (order) => order.units),
    revenuePLN: revenue,
    marginPLN: margin,
    marginPct: ratio(margin, revenue) * 100,
    avgOrderValuePLN: averageOrderValue(orders),
    customers: new Set(orders.map((order) => order.customerName).filter(Boolean)).size,
  }
}

function peakOf(series: readonly DailyPoint[], pick: (point: DailyPoint) => number) {
  if (series.length === 0) return null
  let best = series[0]!
  for (const point of series) {
    if (pick(point) > pick(best)) best = point
  }
  const value = pick(best)
  return value > 0 ? { value, label: best.date } : null
}

function meanOf(series: readonly DailyPoint[], pick: (point: DailyPoint) => number): number {
  if (series.length === 0) return 0
  return sum(series, pick) / series.length
}

function changeBetween(current: number, previous: number | null): number | null {
  if (previous === null || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/**
 * KPI cards carry their own context: value, prior window, change, peak bucket,
 * typical bucket, and shape. A bare number cannot be judged as good or bad.
 */
export function buildKpis(
  totals: WindowTotals,
  previous: WindowTotals | null,
  series: readonly DailyPoint[],
  granularityNoun: string,
): Kpi[] {
  return [
    {
      key: 'revenue',
      label: 'Revenue',
      value: totals.revenuePLN,
      previous: previous?.revenuePLN ?? null,
      changePct: changeBetween(totals.revenuePLN, previous?.revenuePLN ?? null),
      peak: peakOf(series, (point) => point.revenuePLN),
      average: meanOf(series, (point) => point.revenuePLN),
      series: series.map((point) => point.revenuePLN),
      format: 'pln',
      hint: `Gross sales converted to PLN. Peak and average are per ${granularityNoun}.`,
    },
    {
      key: 'profit',
      label: 'Profit',
      value: totals.marginPLN,
      previous: previous?.marginPLN ?? null,
      changePct: changeBetween(totals.marginPLN, previous?.marginPLN ?? null),
      peak: peakOf(series, (point) => point.marginPLN),
      average: meanOf(series, (point) => point.marginPLN),
      series: series.map((point) => point.marginPLN),
      format: 'pln',
      hint: `Revenue less marketplace commission and landed product cost — money kept, not turnover.`,
    },
    {
      key: 'margin',
      label: 'Margin rate',
      value: totals.marginPct,
      previous: previous?.marginPct ?? null,
      changePct:
        previous === null ? null : totals.marginPct - previous.marginPct,
      isRate: true,
      peak: peakOf(series, (point) => point.marginPct),
      average: meanOf(series, (point) => point.marginPct),
      series: series.map((point) => point.marginPct),
      format: 'percent',
      hint: 'Profit as a share of revenue. Movement is shown in percentage points, since a rate cannot change by a percentage of itself.',
    },
    {
      key: 'orders',
      label: 'Orders',
      value: totals.orders,
      previous: previous?.orders ?? null,
      changePct: changeBetween(totals.orders, previous?.orders ?? null),
      peak: peakOf(series, (point) => point.orders),
      average: meanOf(series, (point) => point.orders),
      series: series.map((point) => point.orders),
      format: 'number',
      hint: 'Customer purchases. A multi-item basket counts once, not once per product.',
    },
    {
      key: 'basket',
      label: 'Average basket',
      value: totals.avgOrderValuePLN,
      previous: previous?.avgOrderValuePLN ?? null,
      changePct: changeBetween(totals.avgOrderValuePLN, previous?.avgOrderValuePLN ?? null),
      peak: peakOf(series, (point) => point.avgOrderValuePLN),
      average: meanOf(series, (point) => point.avgOrderValuePLN),
      series: series.map((point) => point.avgOrderValuePLN),
      format: 'pln',
      hint: 'Revenue divided by orders — what a typical customer spends per purchase.',
    },
  ]
}

const GRANULARITY_NOUN: Record<string, string> = {
  day: 'day',
  week: 'week',
  month: 'month',
  quarter: 'quarter',
  year: 'year',
}

export interface SnapshotInput {
  allOrders: readonly Order[]
  costs: readonly ProductCost[]
  period: ResolvedPeriod
  coverage: DataCoverage
  comparison: PeriodComparison
}

export function buildSnapshot(input: SnapshotInput): Snapshot {
  const { allOrders, costs, period, coverage, comparison } = input

  const orders = ordersWithin(allOrders, period.from, period.to)
  const previousOrders = period.previous
    ? ordersWithin(allOrders, period.previous.from, period.previous.to)
    : []

  const totals = computeTotals(orders)
  const previousTotals = period.previous ? computeTotals(previousOrders) : null

  const series = buildSeries(orders, period.granularity, { from: period.from, to: period.to })
  const products = buildProductPerformance(orders, costs)
  const previousProducts = buildProductPerformance(previousOrders, costs)
  const channels = buildChannelPerformance(orders)
  const lineItems = orders.flatMap((order) => order.items)

  const kpis = buildKpis(
    totals,
    previousTotals,
    series,
    GRANULARITY_NOUN[period.granularity] ?? 'day',
  )

  const insights = generateInsights({
    lineItems,
    products,
    channels,
    comparison,
    coverage,
  })

  const health = computeHealthScore({
    lineItems,
    products,
    channels,
    comparison,
    coverage,
    criticalFindings: insights.filter((insight) => insight.severity === 'critical').length,
    attentionFindings: insights.filter((insight) => insight.severity === 'attention').length,
  })

  return {
    period,
    orders,
    previousOrders,
    lineItems,
    totals,
    previousTotals,
    kpis,
    series,
    products,
    previousProducts,
    channels,
    health,
    insights,
    isEmpty: orders.length === 0,
  }
}
