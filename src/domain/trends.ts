/**
 * Time-series analysis for the Trends page. Pure functions over the daily
 * series — no React, no formatting.
 */

import { ratio, sum } from './parse'
import type { Channel, DailyPoint, Order } from './types'

/** Minimum history before a moving average says anything a raw line doesn't. */
export const MIN_DAYS_FOR_MOVING_AVERAGE = 7

export interface TrendPoint extends DailyPoint {
  /** Trailing moving average of the plotted metric, null inside the warm-up. */
  revenueMA: number | null
  marginMA: number | null
  ordersMA: number | null
}

/**
 * Trailing moving average over `window` days. The warm-up period is null, not
 * zero — a fabricated early average would invent a trend that never happened.
 */
export function withMovingAverage(daily: readonly DailyPoint[], window: number): TrendPoint[] {
  return daily.map((point, index) => {
    if (index + 1 < window) {
      return { ...point, revenueMA: null, marginMA: null, ordersMA: null }
    }
    const slice = daily.slice(index + 1 - window, index + 1)
    return {
      ...point,
      revenueMA: sum(slice, (p) => p.revenuePLN) / window,
      marginMA: sum(slice, (p) => p.marginPLN) / window,
      ordersMA: sum(slice, (p) => p.orders) / window,
    }
  })
}

export interface WeekdayPattern {
  /** 0 = Monday … 6 = Sunday. */
  dayIndex: number
  label: string
  orders: number
  revenuePLN: number
  marginPLN: number
  /** Number of calendar occurrences of this weekday in the data. */
  occurrences: number
  avgRevenuePLN: number
}

const WEEKDAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/**
 * Trading rhythm by weekday, averaged per occurrence so a range containing two
 * Mondays and one Sunday compares them fairly.
 */
export function buildWeekdayPattern(daily: readonly DailyPoint[]): WeekdayPattern[] {
  const buckets = WEEKDAY_LABELS.map((label, dayIndex) => ({
    dayIndex,
    label,
    orders: 0,
    revenuePLN: 0,
    marginPLN: 0,
    occurrences: 0,
    avgRevenuePLN: 0,
  }))

  for (const point of daily) {
    // getUTCDay: 0 = Sunday. Rotate so Monday leads, matching trading weeks.
    const jsDay = new Date(`${point.date}T00:00:00Z`).getUTCDay()
    const index = (jsDay + 6) % 7
    const bucket = buckets[index]
    if (!bucket) continue
    bucket.orders += point.orders
    bucket.revenuePLN += point.revenuePLN
    bucket.marginPLN += point.marginPLN
    bucket.occurrences += 1
  }

  for (const bucket of buckets) {
    bucket.avgRevenuePLN = ratio(bucket.revenuePLN, bucket.occurrences)
  }

  return buckets
}

export interface ChannelDailyPoint {
  date: string
  allegro: number
  empik: number
}

/** Daily revenue split by channel, for the marketplace comparison chart. */
export function buildChannelDaily(
  orders: readonly Order[],
  daily: readonly DailyPoint[],
): ChannelDailyPoint[] {
  const buckets = new Map<string, Record<Channel, number>>()
  for (const order of orders) {
    if (!order.date) continue
    const key = order.date.toISOString().slice(0, 10)
    const bucket = buckets.get(key) ?? { allegro: 0, empik: 0 }
    bucket[order.source] = (bucket[order.source] ?? 0) + order.revenuePLN
    buckets.set(key, bucket)
  }

  // Reuse the padded calendar from the daily series so gaps stay visible.
  return daily.map((point) => ({
    date: point.date,
    allegro: buckets.get(point.date)?.allegro ?? 0,
    empik: buckets.get(point.date)?.empik ?? 0,
  }))
}

/** Per-product daily revenue, for the product detail chart. */
export function buildProductDaily(
  orders: readonly Order[],
  productKey: string,
  daily: readonly DailyPoint[],
): DailyPoint[] {
  const own = orders.filter((order) => order.productKey === productKey && order.date)
  const buckets = new Map<string, { orders: number; units: number; revenue: number; margin: number }>()
  for (const order of own) {
    const key = order.date!.toISOString().slice(0, 10)
    const bucket = buckets.get(key) ?? { orders: 0, units: 0, revenue: 0, margin: 0 }
    bucket.orders += 1
    bucket.units += order.qty
    bucket.revenue += order.revenuePLN
    bucket.margin += order.marginPLN
    buckets.set(key, bucket)
  }

  return daily.map((point) => {
    const bucket = buckets.get(point.date)
    const revenue = bucket?.revenue ?? 0
    const margin = bucket?.margin ?? 0
    return {
      date: point.date,
      orders: bucket?.orders ?? 0,
      units: bucket?.units ?? 0,
      revenuePLN: revenue,
      marginPLN: margin,
      marginPct: ratio(margin, revenue) * 100,
    }
  })
}
