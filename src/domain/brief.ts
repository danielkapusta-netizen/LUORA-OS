/**
 * The Morning Brief.
 *
 * Composed here rather than in a component because it is a reading of the
 * business, not a rendering concern. Each line is generated from a figure that
 * exists in the context — the brief never says anything the data cannot support.
 */

import { formatDateRange, formatPercent, formatPLN } from '@/lib/format'
import { channelName } from './insights'
import { shortLabel } from './sku'
import type { BusinessContext } from './types'

export interface MorningBrief {
  /** The trading window the brief describes. */
  window: string
  /** One sentence: what happened. */
  headline: string
  /** Supporting sentences: why it happened, and what to watch. */
  body: string[]
  /** The single thing to do first today. */
  focus: string | null
}

export function buildMorningBrief(context: BusinessContext): MorningBrief {
  const { comparison, products, channels, coverage, insights, summary } = context
  const { current, previous, windowDays } = comparison

  const window = comparison.isReliable
    ? `Last ${windowDays} days · ${formatDateRange(current.from, current.to)}`
    : `All trading to date · ${formatDateRange(coverage.firstOrder, coverage.lastOrder)}`

  const body: string[] = []

  // What happened.
  const headline = comparison.isReliable
    ? `${formatPLN(current.revenuePLN)} revenue and ${formatPLN(current.marginPLN)} profit across ${current.orders} orders, at ${formatPercent(current.marginPct)} margin.`
    : `${formatPLN(summary.totalRevenuePLN)} revenue and ${formatPLN(summary.totalMarginPLN)} profit across ${summary.totalOrders} orders, at ${formatPercent(summary.avgMarginPct)} margin.`

  // Why — direction of travel against a like-for-like window.
  if (comparison.isReliable && comparison.revenueChangePct !== null) {
    const change = comparison.revenueChangePct
    const direction = change > 0 ? 'up' : 'down'
    const marginNote =
      comparison.marginChangePct !== null && Math.abs(comparison.marginChangePct) >= 5
        ? ` Profit moved ${comparison.marginChangePct > 0 ? 'up' : 'down'} ${Math.abs(comparison.marginChangePct).toFixed(0)}% over the same comparison.`
        : ''
    body.push(
      `That is ${direction} ${Math.abs(change).toFixed(1)}% on the previous ${windowDays} days, which turned ${formatPLN(previous.revenuePLN)} into ${formatPLN(previous.marginPLN)} of profit.${marginNote}`,
    )
  }

  // Who carried it.
  const leader = products[0]
  if (leader) {
    body.push(
      `${shortLabel(leader.label, 46)} is carrying the book with ${formatPLN(leader.revenuePLN)} of revenue and ${formatPercent(leader.marginShare * 100, 0)} of all profit, at ${formatPercent(leader.marginPct)} margin.`,
    )
  }

  // Where it was sold.
  const [topChannel, secondChannel] = channels
  if (topChannel && secondChannel) {
    const better = topChannel.marginPct >= secondChannel.marginPct ? topChannel : secondChannel
    body.push(
      `${channelName(topChannel.source)} drove ${formatPercent(topChannel.revenueShare * 100, 0)} of revenue, but ${channelName(better.source)} is the more profitable channel at ${formatPercent(better.marginPct)} margin.`,
    )
  }

  // What to do first — the highest-severity insight that carries money.
  const priority = insights.find((insight) => insight.severity !== 'info') ?? insights[0] ?? null

  return {
    window,
    headline,
    body,
    focus: priority ? `${priority.title}. ${priority.action}` : null,
  }
}
