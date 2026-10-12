/**
 * The Business Snapshot period system.
 *
 * Every figure in Luora OS is scoped by a period chosen once, globally. Two
 * decisions shape this module:
 *
 *  1. **Comparison windows are equal length.** "This month" compares against the
 *     same number of elapsed days in the previous month, not the whole month —
 *     otherwise day 3 of October always looks catastrophic against all of
 *     September.
 *  2. **The clock follows the data.** If the feed stops updating, periods anchor
 *     to the newest order rather than to wall-clock time, and say so. A briefing
 *     that reports an empty "today" because the sync broke is worse than useless.
 */

import type { Granularity } from './types'

export type PeriodKey =
  | 'today'
  | 'yesterday'
  | 'week'
  | 'month'
  | 'quarter'
  | 'year'
  | 'all'
  | 'custom'

export interface ResolvedPeriod {
  key: PeriodKey
  /** Short label for the selector, e.g. "This month". */
  label: string
  /** Inclusive start. */
  from: Date
  /** Inclusive end. */
  to: Date
  /** The equal-length window immediately before, or null for all-time. */
  previous: { from: Date; to: Date } | null
  /** Human phrase for the comparison, e.g. "vs previous 27 days". */
  comparisonLabel: string
  /** Days spanned, inclusive. */
  days: number
  /** Sensible chart grain for a window of this length. */
  granularity: Granularity
  /** True when the period was anchored to the newest order, not wall clock. */
  isAnchoredToData: boolean
  /**
   * How much of the comparison window the business was actually trading for.
   *
   * "This year" compares against the equal-length window before it, which for a
   * young business reaches back past the first ever order. Dividing by a window
   * that is mostly pre-history produces figures like +1518% that are
   * arithmetically true and completely meaningless. Anything other than `full`
   * means the delta should be withheld rather than shown.
   */
  previousCoverage: 'full' | 'partial' | 'none'
}

export const PERIOD_OPTIONS: Array<{ value: PeriodKey; label: string }> = [
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'year', label: 'This year' },
  { value: 'all', label: 'All time' },
]

const DAY_MS = 86_400_000

function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
}

function endOfDay(date: Date): Date {
  return new Date(startOfDay(date).getTime() + DAY_MS - 1)
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

/** Monday-led week start, matching how trading weeks are read. */
function startOfWeek(date: Date): Date {
  const day = startOfDay(date)
  const offset = (day.getUTCDay() + 6) % 7
  return addDays(day, -offset)
}

function startOfMonth(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1))
}

function startOfQuarter(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), Math.floor(date.getUTCMonth() / 3) * 3, 1))
}

function startOfYear(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), 0, 1))
}

function daysBetween(from: Date, to: Date): number {
  return Math.max(1, Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS) + 1)
}

/** Chart grain that keeps a series readable rather than dense. */
export function granularityFor(days: number): Granularity {
  if (days <= 31) return 'day'
  if (days <= 120) return 'week'
  if (days <= 800) return 'month'
  return 'quarter'
}

/**
 * Choose the reference "now". Wall clock normally; the newest order when the
 * feed has fallen behind, so a stalled sync degrades into stale-but-honest
 * figures instead of empty ones.
 */
export function resolveAnchor(lastOrder: Date | null, now: Date = new Date()): {
  anchor: Date
  isAnchoredToData: boolean
} {
  if (!lastOrder) return { anchor: now, isAnchoredToData: false }
  const staleDays = (startOfDay(now).getTime() - startOfDay(lastOrder).getTime()) / DAY_MS
  if (staleDays >= 1) return { anchor: lastOrder, isAnchoredToData: true }
  return { anchor: now, isAnchoredToData: false }
}

export interface CustomRange {
  from: Date
  to: Date
}

export function resolvePeriod(
  key: PeriodKey,
  lastOrder: Date | null,
  firstOrder: Date | null,
  custom?: CustomRange,
  now: Date = new Date(),
): ResolvedPeriod {
  const { anchor, isAnchoredToData } = resolveAnchor(lastOrder, now)
  const today = startOfDay(anchor)

  let from: Date
  let to: Date = endOfDay(anchor)
  let label: string

  switch (key) {
    case 'today':
      from = today
      label = 'Today'
      break
    case 'yesterday':
      from = addDays(today, -1)
      to = endOfDay(from)
      label = 'Yesterday'
      break
    case 'week':
      from = startOfWeek(anchor)
      label = 'This week'
      break
    case 'month':
      from = startOfMonth(anchor)
      label = 'This month'
      break
    case 'quarter':
      from = startOfQuarter(anchor)
      label = 'This quarter'
      break
    case 'year':
      from = startOfYear(anchor)
      label = 'This year'
      break
    case 'custom':
      from = startOfDay(custom?.from ?? today)
      to = endOfDay(custom?.to ?? anchor)
      label = 'Custom range'
      break
    case 'all':
    default:
      from = startOfDay(firstOrder ?? today)
      label = 'All time'
      break
  }

  const days = daysBetween(from, to)

  // All-time has nothing before it to compare against; every other period
  // compares with the equal-length window immediately preceding it.
  const previous =
    key === 'all'
      ? null
      : {
          from: addDays(startOfDay(from), -days),
          to: new Date(startOfDay(from).getTime() - 1),
        }

  const comparisonLabel =
    key === 'all'
      ? 'no prior window'
      : key === 'today'
        ? 'vs yesterday'
        : key === 'yesterday'
          ? 'vs the day before'
          : `vs previous ${days} day${days === 1 ? '' : 's'}`

  // A comparison is only like-for-like if the business was trading across the
  // whole of the window being compared against.
  let previousCoverage: 'full' | 'partial' | 'none' = 'full'
  if (!previous) {
    previousCoverage = 'none'
  } else if (firstOrder) {
    const firstDay = startOfDay(firstOrder)
    if (previous.to < firstDay) previousCoverage = 'none'
    else if (previous.from < firstDay) previousCoverage = 'partial'
  }

  return {
    key,
    label,
    from,
    to,
    previous,
    comparisonLabel,
    days,
    granularity: granularityFor(days),
    isAnchoredToData,
    previousCoverage,
  }
}

/** Bucket start for a date at the requested grain, as `YYYY-MM-DD`. */
export function bucketKey(date: Date, granularity: Granularity): string {
  switch (granularity) {
    case 'week':
      return startOfWeek(date).toISOString().slice(0, 10)
    case 'month':
      return startOfMonth(date).toISOString().slice(0, 10)
    case 'quarter':
      return startOfQuarter(date).toISOString().slice(0, 10)
    case 'year':
      return startOfYear(date).toISOString().slice(0, 10)
    case 'day':
    default:
      return startOfDay(date).toISOString().slice(0, 10)
  }
}

/** Advance one bucket, used to pad empty periods so gaps stay visible. */
export function nextBucket(date: Date, granularity: Granularity): Date {
  const d = new Date(date)
  switch (granularity) {
    case 'week':
      return addDays(d, 7)
    case 'month':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))
    case 'quarter':
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 3, 1))
    case 'year':
      return new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 1))
    case 'day':
    default:
      return addDays(d, 1)
  }
}

export function isWithin(date: Date | null, from: Date, to: Date): boolean {
  if (!date) return false
  const time = date.getTime()
  return time >= from.getTime() && time <= to.getTime()
}
