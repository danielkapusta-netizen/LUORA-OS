/**
 * Business Review composition — the executive report, written from the data.
 *
 * Deliberately narrative-first. The product scorecard table lives on the
 * Products page; duplicating it here would make this a second catalogue view
 * rather than a report. What belongs here is the reading a founder would want
 * to hand to an investor: what happened, why, and what is changing underneath.
 */

import { formatDateRange, formatPercent, formatPLN } from '@/lib/format'
import { channelName } from './insights'
import { ratio } from './parse'
import { shortLabel } from './sku'
import type { Snapshot } from './snapshot'
import type { DataCoverage } from './types'

export interface ReviewInsight {
  /** Short label, e.g. "Margin" or "Basket". */
  topic: string
  /** The observation, stated as a finding rather than a metric. */
  statement: string
  tone: 'positive' | 'negative' | 'neutral'
}

export interface BusinessReview {
  periodLabel: string
  /** Headline figures for the executive summary block. */
  summary: Array<{ label: string; value: string; caption: string }>
  /** The report body. */
  narrative: string[]
  /** Automatically generated observations. */
  insights: ReviewInsight[]
}

/** Consecutive rising buckets at the end of a series — used for streak claims. */
function trailingStreak(values: readonly number[]): { direction: 'up' | 'down'; length: number } {
  if (values.length < 2) return { direction: 'up', length: 0 }
  const last = values.length - 1
  const direction = (values[last] ?? 0) >= (values[last - 1] ?? 0) ? 'up' : 'down'
  let length = 0
  for (let index = last; index > 0; index -= 1) {
    const current = values[index] ?? 0
    const previous = values[index - 1] ?? 0
    const rising = current >= previous
    if ((direction === 'up') !== rising) break
    length += 1
  }
  return { direction, length }
}

export function buildBusinessReview(
  snapshot: Snapshot,
  coverage: DataCoverage,
): BusinessReview {
  const { period, totals, previousTotals, products, channels, series } = snapshot

  const periodLabel =
    period.key === 'all'
      ? `All trading · ${formatDateRange(coverage.firstOrder, coverage.lastOrder)}`
      : `${formatDateRange(period.from, period.to)}`

  const summary = [
    {
      label: 'Revenue',
      value: formatPLN(totals.revenuePLN),
      caption: previousTotals ? `from ${formatPLN(previousTotals.revenuePLN)}` : 'no prior window',
    },
    {
      label: 'Profit',
      value: formatPLN(totals.marginPLN),
      caption: previousTotals ? `from ${formatPLN(previousTotals.marginPLN)}` : 'no prior window',
    },
    {
      label: 'Margin',
      value: formatPercent(totals.marginPct),
      caption: previousTotals
        ? `from ${formatPercent(previousTotals.marginPct)}`
        : 'no prior window',
    },
    {
      label: 'Orders',
      value: totals.orders.toLocaleString('en-GB'),
      caption: `${totals.customers.toLocaleString('en-GB')} customers`,
    },
    {
      label: 'Average basket',
      value: formatPLN(totals.avgOrderValuePLN),
      caption: previousTotals
        ? `from ${formatPLN(previousTotals.avgOrderValuePLN)}`
        : 'no prior window',
    },
    {
      label: 'Business health',
      value: `${snapshot.health.score}/100`,
      caption: snapshot.health.band.replace('-', ' '),
    },
  ]

  const narrative: string[] = []

  narrative.push(
    `Luora took ${formatPLN(totals.revenuePLN)} of revenue across ${totals.orders.toLocaleString('en-GB')} orders in this period and kept ${formatPLN(totals.marginPLN)} of it — a ${formatPercent(totals.marginPct)} margin after marketplace commission and landed product cost.`,
  )

  if (previousTotals && previousTotals.revenuePLN > 0) {
    const revenueChange =
      ((totals.revenuePLN - previousTotals.revenuePLN) / previousTotals.revenuePLN) * 100
    const marginShift = totals.marginPct - previousTotals.marginPct
    narrative.push(
      `Against the preceding ${period.days} days, revenue ${revenueChange >= 0 ? 'rose' : 'fell'} ${Math.abs(revenueChange).toFixed(1)}% and margin moved ${marginShift >= 0 ? 'up' : 'down'} ${Math.abs(marginShift).toFixed(1)} points to ${formatPercent(totals.marginPct)}. ${
        revenueChange >= 0 && marginShift < 0
          ? 'Growth came at the cost of profitability, which is the pattern worth watching.'
          : revenueChange < 0 && marginShift > 0
            ? 'Volume softened but the business kept more of what it sold.'
            : revenueChange >= 0 && marginShift >= 0
              ? 'Both volume and profitability moved in the same, right direction.'
              : 'Both volume and profitability moved down together.'
      }`,
    )
  }

  const leader = products[0]
  if (leader) {
    const topFive = products.slice(0, 5)
    const topFiveShare = topFive.reduce((total, product) => total + product.revenueShare, 0)
    narrative.push(
      `${shortLabel(leader.label, 44)} led the period with ${formatPLN(leader.revenuePLN)} of revenue and ${formatPercent(leader.marginShare * 100, 0)} of all profit. The top five products account for ${formatPercent(topFiveShare * 100, 0)} of revenue, so performance remains concentrated in a small part of the catalogue.`,
    )
  }

  const [first, second] = channels
  if (first && second) {
    const gap = Math.abs(first.marginPct - second.marginPct)
    const worse = first.marginPct >= second.marginPct ? second : first
    narrative.push(
      `${channelName(first.source)} carried ${formatPercent(first.revenueShare * 100, 0)} of revenue at ${formatPercent(first.marginPct)} margin, against ${formatPercent(second.revenueShare * 100, 0)} at ${formatPercent(second.marginPct)} on ${channelName(second.source)}. Closing the ${gap.toFixed(1)}-point gap on ${channelName(worse.source)} would be worth roughly ${formatPLN((worse.revenuePLN * gap) / 100)} at current volume.`,
    )
  }

  const lossMakers = products.filter((product) => product.marginPLN < 0)
  if (lossMakers.length > 0) {
    const bleed = lossMakers.reduce((total, product) => total + product.marginPLN, 0)
    narrative.push(
      `${lossMakers.length} product${lossMakers.length === 1 ? '' : 's'} sold at a loss this period, costing ${formatPLN(Math.abs(bleed))}. These are listed in the Action Centre with the pricing decision each one needs.`,
    )
  }

  if (coverage.linesMissingCost > 0) {
    narrative.push(
      `One caveat on the figures above: ${formatPLN(coverage.revenueMissingCostPLN)} of revenue has no landed cost on file, so its profit excludes COGS and reads better than it is.`,
    )
  }

  // ── Automatically generated observations ────────────────────────────────
  const insights: ReviewInsight[] = []

  const revenueSeries = series.filter((point) => point.orders > 0).map((point) => point.revenuePLN)
  const streak = trailingStreak(revenueSeries)
  if (streak.length >= 3) {
    insights.push({
      topic: 'Momentum',
      statement: `Revenue has moved ${streak.direction === 'up' ? 'up' : 'down'} for ${streak.length} consecutive ${period.granularity}s.`,
      tone: streak.direction === 'up' ? 'positive' : 'negative',
    })
  }

  if (previousTotals && previousTotals.avgOrderValuePLN > 0) {
    const basketChange =
      ((totals.avgOrderValuePLN - previousTotals.avgOrderValuePLN) /
        previousTotals.avgOrderValuePLN) *
      100
    if (Math.abs(basketChange) >= 4) {
      insights.push({
        topic: 'Basket',
        statement: `Average basket ${basketChange > 0 ? 'grew' : 'shrank'} ${Math.abs(basketChange).toFixed(1)}% to ${formatPLN(totals.avgOrderValuePLN)}${basketChange < 0 ? ' — customers are buying less per visit.' : '.'}`,
        tone: basketChange > 0 ? 'positive' : 'negative',
      })
    }
  }

  if (previousTotals && previousTotals.revenuePLN > 0 && previousTotals.marginPLN !== 0) {
    const revenueGrowth =
      ((totals.revenuePLN - previousTotals.revenuePLN) / previousTotals.revenuePLN) * 100
    const profitGrowth =
      ((totals.marginPLN - previousTotals.marginPLN) / Math.abs(previousTotals.marginPLN)) * 100
    if (revenueGrowth > 2 && profitGrowth < revenueGrowth) {
      insights.push({
        topic: 'Profit quality',
        statement: `Revenue grew ${revenueGrowth.toFixed(1)}% but profit only ${profitGrowth.toFixed(1)}% — the business is getting larger faster than it is getting better.`,
        tone: 'negative',
      })
    } else if (profitGrowth > revenueGrowth && profitGrowth > 2) {
      insights.push({
        topic: 'Profit quality',
        statement: `Profit grew ${profitGrowth.toFixed(1)}% against ${revenueGrowth.toFixed(1)}% revenue growth — each złoty of sales is worth more than it was.`,
        tone: 'positive',
      })
    }
  }

  const thin = products.filter(
    (product) => product.marginPct < 15 && product.revenueShare >= 0.02,
  )
  if (thin.length > 0) {
    const thinRevenue = thin.reduce((total, product) => total + product.revenuePLN, 0)
    insights.push({
      topic: 'Margin',
      statement: `${thin.length} material product${thin.length === 1 ? '' : 's'} trade below 15% margin, covering ${formatPercent(ratio(thinRevenue, totals.revenuePLN) * 100, 0)} of revenue. Repricing these is the fastest available margin lever.`,
      tone: 'negative',
    })
  }

  if (products.length > 0) {
    const topShare = products[0]!.marginShare
    if (topShare > 0.3) {
      insights.push({
        topic: 'Concentration',
        statement: `${formatPercent(topShare * 100, 0)} of profit comes from a single product, so a stockout or price war on that listing would be felt immediately.`,
        tone: 'negative',
      })
    }
  }

  return { periodLabel, summary, narrative, insights }
}
