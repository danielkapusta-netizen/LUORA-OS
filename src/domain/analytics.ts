/**
 * The analytics engine behind the Trends workspace.
 *
 * Builds a single aligned series where each bucket carries its own value plus
 * every comparison overlay — previous period, same period last year, moving
 * average and forecast. Aligning them here rather than in the chart means the
 * chart is a renderer, and "compare to last year" is a data question answered
 * once instead of three times in three components.
 */

import { inferBrand, inferCategory } from './orders'
import { bucketKey, nextBucket, type ResolvedPeriod } from './period'
import { ratio, sum } from './parse'
import type { DailyPoint, Granularity, Order } from './types'

/** Metrics the workspace can plot. Each is a full analytical section. */
export type AnalyticsMetric =
  | 'revenue'
  | 'profit'
  | 'margin'
  | 'orders'
  | 'basket'
  | 'contribution'

export interface MetricDefinition {
  key: AnalyticsMetric
  label: string
  description: string
  format: 'pln' | 'number' | 'percent'
  /** Reads a value out of an aggregated bucket. */
  pick: (point: DailyPoint) => number
  /** False where a rise is bad news. */
  higherIsBetter: boolean
}

export const METRIC_DEFINITIONS: Record<AnalyticsMetric, MetricDefinition> = {
  revenue: {
    key: 'revenue',
    label: 'Revenue',
    description: 'Gross sales converted to PLN, before commission and product cost.',
    format: 'pln',
    pick: (point) => point.revenuePLN,
    higherIsBetter: true,
  },
  profit: {
    key: 'profit',
    label: 'Profit',
    description: 'What is kept after marketplace commission and landed product cost.',
    format: 'pln',
    pick: (point) => point.marginPLN,
    higherIsBetter: true,
  },
  margin: {
    key: 'margin',
    label: 'Margin',
    description: 'Profit as a share of revenue — the rate at which sales become money.',
    format: 'percent',
    pick: (point) => point.marginPct,
    higherIsBetter: true,
  },
  orders: {
    key: 'orders',
    label: 'Orders',
    description: 'Customer purchases. A multi-item basket counts once.',
    format: 'number',
    pick: (point) => point.orders,
    higherIsBetter: true,
  },
  basket: {
    key: 'basket',
    label: 'Average basket',
    description: 'Revenue divided by orders — what a typical customer spends.',
    format: 'pln',
    pick: (point) => point.avgOrderValuePLN,
    higherIsBetter: true,
  },
  contribution: {
    key: 'contribution',
    label: 'Profit per order',
    description: 'Profit divided by orders — what each purchase actually contributes.',
    format: 'pln',
    pick: (point) => ratio(point.marginPLN, point.orders),
    higherIsBetter: true,
  },
}

export const METRIC_ORDER: AnalyticsMetric[] = [
  'revenue',
  'profit',
  'margin',
  'orders',
  'basket',
  'contribution',
]

/** Overlays a chart can draw on top of the primary series. */
export type OverlayKey = 'previous' | 'lastYear' | 'movingAverage' | 'forecast'

export interface AnalyticsPoint {
  /** Bucket start, `YYYY-MM-DD`. */
  date: string
  /** Actual value for this bucket, null for future forecast buckets. */
  value: number | null
  /** Same position in the immediately preceding window. */
  previous: number | null
  /** Same position one year earlier. */
  lastYear: number | null
  /** Trailing average of `value`, null through the warm-up. */
  movingAverage: number | null
  /** Projection beyond the last actual bucket, null everywhere else. */
  forecast: number | null
  /** True for buckets that have not happened yet. */
  isProjected: boolean
}

export interface AnalyticsSeries {
  metric: AnalyticsMetric
  granularity: Granularity
  points: AnalyticsPoint[]
  /** Which overlays actually carry data, so the UI can disable empty ones. */
  available: Record<OverlayKey, boolean>
  /** Total of actual values across the period. */
  total: number
  /** Change against the previous window, percent — or points for rates. */
  changePct: number | null
  /** Forecast total for the full period, when projection is possible. */
  projectedTotal: number | null
}

/** Aggregates orders into buckets at the requested grain across a fixed range. */
function bucketize(
  orders: readonly Order[],
  granularity: Granularity,
  from: Date,
  to: Date,
): Map<string, DailyPoint> {
  const buckets = new Map<string, { orders: number; units: number; revenue: number; margin: number }>()

  for (const order of orders) {
    if (!order.date) continue
    if (order.date < from || order.date > to) continue
    const key = bucketKey(order.date, granularity)
    const bucket = buckets.get(key) ?? { orders: 0, units: 0, revenue: 0, margin: 0 }
    bucket.orders += 1
    bucket.units += order.units
    bucket.revenue += order.revenuePLN
    bucket.margin += order.marginPLN
    buckets.set(key, bucket)
  }

  const result = new Map<string, DailyPoint>()
  for (const [key, bucket] of buckets) {
    result.set(key, {
      date: key,
      orders: bucket.orders,
      units: bucket.units,
      revenuePLN: bucket.revenue,
      marginPLN: bucket.margin,
      marginPct: ratio(bucket.margin, bucket.revenue) * 100,
      avgOrderValuePLN: ratio(bucket.revenue, bucket.orders),
    })
  }
  return result
}

function emptyPoint(date: string): DailyPoint {
  return {
    date,
    orders: 0,
    units: 0,
    revenuePLN: 0,
    marginPLN: 0,
    marginPct: 0,
    avgOrderValuePLN: 0,
  }
}

/** Ordered list of bucket keys spanning a range at a given grain. */
function bucketKeysBetween(from: Date, to: Date, granularity: Granularity): string[] {
  const keys: string[] = []
  let cursor = new Date(`${bucketKey(from, granularity)}T00:00:00Z`)
  let guard = 0
  while (cursor.getTime() <= to.getTime() && guard < 2000) {
    keys.push(cursor.toISOString().slice(0, 10))
    cursor = nextBucket(cursor, granularity)
    guard += 1
  }
  return keys
}

/** Shifts a date back one calendar year, for the year-on-year overlay. */
function minusOneYear(date: Date): Date {
  return new Date(
    Date.UTC(date.getUTCFullYear() - 1, date.getUTCMonth(), date.getUTCDate()),
  )
}

/**
 * Linear projection from the trailing portion of the actual series.
 *
 * Deliberately simple: a least-squares fit over recent buckets, clamped at
 * zero. A more elaborate model would imply a confidence this data volume does
 * not support, and a founder acting on a forecast deserves to know it is a
 * straight line through recent trade rather than something that has priced in
 * seasonality it has never observed.
 */
function projectForward(values: number[], steps: number): number[] {
  const usable = values.filter((value) => Number.isFinite(value))
  if (usable.length < 3 || steps <= 0) return []

  // Fit on the trailing half, so an old trend does not dominate a recent turn.
  const window = Math.max(3, Math.ceil(usable.length / 2))
  const recent = usable.slice(-window)
  const n = recent.length

  const meanX = (n - 1) / 2
  const meanY = recent.reduce((total, value) => total + value, 0) / n
  let numerator = 0
  let denominator = 0
  recent.forEach((value, index) => {
    numerator += (index - meanX) * (value - meanY)
    denominator += (index - meanX) ** 2
  })
  const slope = denominator === 0 ? 0 : numerator / denominator
  const intercept = meanY - slope * meanX

  return Array.from({ length: steps }, (_, step) =>
    Math.max(0, intercept + slope * (n - 1 + step + 1)),
  )
}

export interface AnalyticsInput {
  allOrders: readonly Order[]
  period: ResolvedPeriod
  metric: AnalyticsMetric
  /** Overrides the period's natural grain when the user drills in or out. */
  granularity?: Granularity
  movingAverageWindow?: number
  /** How many buckets beyond the last actual one to project. */
  forecastSteps?: number
}

export function buildAnalyticsSeries(input: AnalyticsInput): AnalyticsSeries {
  const { allOrders, period, metric } = input
  const granularity = input.granularity ?? period.granularity
  const definition = METRIC_DEFINITIONS[metric]
  const maWindow = input.movingAverageWindow ?? (granularity === 'day' ? 7 : 3)

  const current = bucketize(allOrders, granularity, period.from, period.to)
  const keys = bucketKeysBetween(period.from, period.to, granularity)

  // Previous window: same length, immediately before. Aligned positionally,
  // since calendar months differ in length and a date-based join would drop
  // buckets at the edges.
  const previousBuckets = period.previous
    ? bucketize(allOrders, granularity, period.previous.from, period.previous.to)
    : new Map<string, DailyPoint>()
  const previousKeys = period.previous
    ? bucketKeysBetween(period.previous.from, period.previous.to, granularity)
    : []

  // Last year: the same calendar window, twelve months back.
  const lastYearFrom = minusOneYear(period.from)
  const lastYearTo = minusOneYear(period.to)
  const lastYearBuckets = bucketize(allOrders, granularity, lastYearFrom, lastYearTo)
  const lastYearKeys = bucketKeysBetween(lastYearFrom, lastYearTo, granularity)

  const values = keys.map((key) => definition.pick(current.get(key) ?? emptyPoint(key)))

  // A bucket is "actual" only if it has started; forecast fills the rest.
  const now = Date.now()
  const actualCount = keys.filter(
    (key) => new Date(`${key}T00:00:00Z`).getTime() <= now,
  ).length
  const futureSteps = input.forecastSteps ?? Math.max(0, keys.length - actualCount)
  const projected = projectForward(values.slice(0, actualCount), futureSteps)

  const points: AnalyticsPoint[] = keys.map((key, index) => {
    const isProjected = index >= actualCount
    const value = isProjected ? null : (values[index] ?? 0)

    const maSlice = values.slice(Math.max(0, index - maWindow + 1), index + 1)
    const movingAverage =
      !isProjected && index + 1 >= maWindow
        ? maSlice.reduce((total, item) => total + item, 0) / maSlice.length
        : null

    const previousKey = previousKeys[index]
    const lastYearKey = lastYearKeys[index]

    return {
      date: key,
      value,
      previous: previousKey
        ? definition.pick(previousBuckets.get(previousKey) ?? emptyPoint(previousKey))
        : null,
      lastYear: lastYearKey
        ? definition.pick(lastYearBuckets.get(lastYearKey) ?? emptyPoint(lastYearKey))
        : null,
      movingAverage,
      forecast: isProjected ? (projected[index - actualCount] ?? null) : null,
      isProjected,
    }
  })

  const actualValues = values.slice(0, actualCount)
  // Rates and per-order figures cannot be summed — they are re-derived from
  // the period totals instead, or a 30-day margin would read as 400%.
  const isAverageMetric = metric === 'margin' || metric === 'basket' || metric === 'contribution'
  const total = isAverageMetric
    ? recomputeAverageMetric(metric, current, keys.slice(0, actualCount))
    : sum(actualValues, (value) => value)

  const previousTotal = isAverageMetric
    ? recomputeAverageMetric(metric, previousBuckets, previousKeys)
    : sum(previousKeys, (key) => definition.pick(previousBuckets.get(key) ?? emptyPoint(key)))

  // Withheld when the comparison window predates the business — see
  // `previousCoverage` in period.ts for why a number here would mislead.
  const changePct =
    previousKeys.length === 0 || previousTotal === 0 || period.previousCoverage !== 'full'
      ? null
      : metric === 'margin'
        ? total - previousTotal
        : ((total - previousTotal) / Math.abs(previousTotal)) * 100

  const projectedTotal =
    projected.length > 0 && !isAverageMetric
      ? total + projected.reduce((sumValue, value) => sumValue + value, 0)
      : null

  return {
    metric,
    granularity,
    points,
    available: {
      previous: previousKeys.length > 0,
      lastYear: lastYearBuckets.size > 0,
      movingAverage: actualCount >= maWindow,
      forecast: projected.length > 0,
    },
    total,
    changePct,
    projectedTotal,
  }
}

/** Rates are recomputed from summed components, never averaged across buckets. */
function recomputeAverageMetric(
  metric: AnalyticsMetric,
  buckets: Map<string, DailyPoint>,
  keys: readonly string[],
): number {
  let revenue = 0
  let margin = 0
  let orders = 0
  for (const key of keys) {
    const bucket = buckets.get(key)
    if (!bucket) continue
    revenue += bucket.revenuePLN
    margin += bucket.marginPLN
    orders += bucket.orders
  }
  if (metric === 'margin') return ratio(margin, revenue) * 100
  if (metric === 'basket') return ratio(revenue, orders)
  return ratio(margin, orders)
}

/** Grains offered for drill-down, filtered to those the period can support. */
export function availableGranularities(period: ResolvedPeriod): Granularity[] {
  const all: Array<{ value: Granularity; minDays: number }> = [
    { value: 'day', minDays: 0 },
    { value: 'week', minDays: 14 },
    { value: 'month', minDays: 60 },
    { value: 'quarter', minDays: 200 },
    { value: 'year', minDays: 400 },
  ]
  return all
    .filter((option) => period.days >= option.minDays)
    // A grain is useless if the whole period is one bucket.
    .filter((option) => !(option.value === 'year' && period.days < 400))
    .map((option) => option.value)
}

/** Distinct calendar months present in the data, newest first. */
export function monthsAvailable(orders: readonly Order[]): string[] {
  const months = new Set<string>()
  for (const order of orders) {
    if (!order.date) continue
    months.add(order.date.toISOString().slice(0, 7))
  }
  return [...months].sort().reverse()
}

export interface HeatmapCell {
  row: string
  column: string
  value: number
  /** Value normalised against the strongest cell in the grid, 0–1. */
  intensity: number
}

/**
 * Month-by-product (or brand) grid of revenue or profit. Intensity is scaled
 * against the strongest cell so the eye finds concentration without reading
 * a single number.
 */
export function buildHeatmap(
  orders: readonly Order[],
  rowKey: 'product' | 'brand' | 'category',
  measure: 'revenue' | 'margin',
  monthLimit = 6,
  rowLimit = 8,
): { rows: string[]; columns: string[]; cells: HeatmapCell[] } {
  const months = monthsAvailable(orders).slice(0, monthLimit).reverse()
  const monthSet = new Set(months)

  const totals = new Map<string, number>()
  const grid = new Map<string, number>()

  for (const order of orders) {
    if (!order.date) continue
    const month = order.date.toISOString().slice(0, 7)
    if (!monthSet.has(month)) continue

    for (const line of order.items) {
      const label =
        rowKey === 'product'
          ? line.productLabel
          : rowKey === 'brand'
            ? inferBrand(line.productLabel)
            : inferCategory(line.productLabel)
      const value = measure === 'revenue' ? line.revenuePLN : line.marginPLN
      totals.set(label, (totals.get(label) ?? 0) + value)
      const cellKey = `${label}|${month}`
      grid.set(cellKey, (grid.get(cellKey) ?? 0) + value)
    }
  }

  const rows = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, rowLimit)
    .map(([label]) => label)

  const peak = Math.max(
    1,
    ...rows.flatMap((row) => months.map((month) => Math.abs(grid.get(`${row}|${month}`) ?? 0))),
  )

  const cells: HeatmapCell[] = []
  for (const row of rows) {
    for (const month of months) {
      const value = grid.get(`${row}|${month}`) ?? 0
      cells.push({ row, column: month, value, intensity: Math.abs(value) / peak })
    }
  }

  return { rows, columns: months, cells }
}
