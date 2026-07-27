/**
 * Business Review composition — the executive report, written from the data.
 *
 * Like the morning brief, this lives in the domain layer because it is a
 * reading of the business, not a rendering concern. Every sentence traces to a
 * figure in the context.
 */

import { formatDateRange, formatPercent, formatPLN } from '@/lib/format'
import { channelName } from './insights'
import { ratio, sum } from './parse'
import { shortLabel } from './sku'
import type { BusinessContext } from './context'
import type { ProductPerformance } from './types'

export interface ProductScorecard {
  product: ProductPerformance
  /** Revenue in the current comparison window. */
  currentRevenuePLN: number
  /** Revenue in the previous comparison window. */
  previousRevenuePLN: number
  /** Percentage change between windows, null without a baseline. */
  revenueChangePct: number | null
  /** Cumulative revenue share when products are ranked by revenue, 0–1. */
  cumulativeShare: number
}

export interface BusinessReview {
  periodLabel: string
  /** The report itself: ordered paragraphs of plain language. */
  narrative: string[]
  scorecards: ProductScorecard[]
  /** How many products it takes to reach 80% of revenue. */
  productsFor80pct: number
}

export function buildBusinessReview(context: BusinessContext): BusinessReview {
  const { products, channels, comparison, coverage, summary } = context
  const { current, previous, windowDays, isReliable } = comparison

  const periodLabel = isReliable
    ? `${formatDateRange(current.from, current.to)} vs ${formatDateRange(previous.from, previous.to)}`
    : `All trading · ${formatDateRange(coverage.firstOrder, coverage.lastOrder)}`

  // Per-product revenue inside each comparison window, for the scorecards.
  const currentSet = new Set<string>()
  const windowRevenue = new Map<string, { current: number; previous: number }>()
  if (isReliable) {
    const fromCurrent = new Date(`${current.from}T00:00:00Z`).getTime()
    const fromPrevious = new Date(`${previous.from}T00:00:00Z`).getTime()
    for (const line of context.lineItems) {
      if (!line.date) continue
      const time = line.date.getTime()
      const entry = windowRevenue.get(line.productKey) ?? { current: 0, previous: 0 }
      if (time >= fromCurrent) {
        entry.current += line.revenuePLN
        currentSet.add(line.productKey)
      } else if (time >= fromPrevious) {
        entry.previous += line.revenuePLN
      }
      windowRevenue.set(line.productKey, entry)
    }
  }

  let cumulative = 0
  let productsFor80pct = 0
  const scorecards: ProductScorecard[] = products.map((product, index) => {
    cumulative += product.revenueShare
    if (cumulative <= 0.8 || productsFor80pct === 0) productsFor80pct = index + 1
    const window = windowRevenue.get(product.productKey)
    return {
      product,
      currentRevenuePLN: window?.current ?? 0,
      previousRevenuePLN: window?.previous ?? 0,
      revenueChangePct:
        window && window.previous > 0
          ? ((window.current - window.previous) / window.previous) * 100
          : null,
      cumulativeShare: cumulative,
    }
  })

  const narrative: string[] = []

  const totalRevenue = summary.totalRevenuePLN
  const totalMargin = summary.totalMarginPLN

  narrative.push(
    `Luora has taken ${formatPLN(totalRevenue)} of revenue across ${summary.totalOrders} orders and kept ${formatPLN(totalMargin)} as profit — a ${formatPercent(summary.avgMarginPct)} portfolio margin after marketplace commission and landed cost.`,
  )

  if (isReliable && comparison.revenueChangePct !== null) {
    const change = comparison.revenueChangePct
    narrative.push(
      `The most recent ${windowDays}-day window ${change >= 0 ? 'grew' : 'contracted'} ${Math.abs(change).toFixed(1)}% against the window before it: ${formatPLN(current.revenuePLN)} from ${current.orders} orders, versus ${formatPLN(previous.revenuePLN)} from ${previous.orders}. Margin rate moved from ${formatPercent(previous.marginPct)} to ${formatPercent(current.marginPct)}.`,
    )
  }

  narrative.push(
    `Revenue is concentrated: ${productsFor80pct} of ${products.length} products produce 80% of it. ${products[0] ? `${shortLabel(products[0].label, 44)} alone accounts for ${formatPercent(products[0].revenueShare * 100, 0)} of revenue and ${formatPercent(products[0].marginShare * 100, 0)} of profit.` : ''}`,
  )

  const [first, second] = channels
  if (first && second) {
    narrative.push(
      `${channelName(first.source)} carries ${formatPercent(first.revenueShare * 100, 0)} of revenue at ${formatPercent(first.marginPct)} margin; ${channelName(second.source)} carries ${formatPercent(second.revenueShare * 100, 0)} at ${formatPercent(second.marginPct)}. The gap of ${Math.abs(first.marginPct - second.marginPct).toFixed(1)} points is worth ${formatPLN((Math.min(first.marginPct, second.marginPct) < first.marginPct ? first : second).revenuePLN * Math.abs(first.marginPct - second.marginPct) / 100)} per period at current volume.`,
    )
  }

  const thin = products.filter((product) => product.marginPct < 15 && product.revenueShare >= 0.02)
  if (thin.length > 0) {
    const thinRevenue = sum(thin, (product) => product.revenuePLN)
    narrative.push(
      `${thin.length} material product${thin.length === 1 ? '' : 's'} trade${thin.length === 1 ? 's' : ''} below 15% margin, representing ${formatPLN(thinRevenue)} of revenue (${formatPercent(ratio(thinRevenue, totalRevenue) * 100, 0)} of the book) at well below portfolio profitability. Repricing these is the fastest available margin lever.`,
    )
  }

  if (coverage.linesMissingCost > 0) {
    narrative.push(
      `Caveat: ${formatPLN(coverage.revenueMissingCostPLN)} of revenue (${coverage.linesMissingCost} product lines) has no landed cost on file, so its reported profit excludes COGS. Figures above should be read as slightly optimistic until those costs are recorded.`,
    )
  }

  return { periodLabel, narrative, scorecards, productsFor80pct }
}
