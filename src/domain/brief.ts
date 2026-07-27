/**
 * The Executive Brief.
 *
 * Written as prose, not assembled from metric fragments, because the founder
 * reads this before anything else and should finish it knowing what happened
 * without decoding a layout. Composed in the domain layer since it is a reading
 * of the business rather than a rendering concern — every clause traces to a
 * figure in the snapshot, and nothing is claimed that the data cannot support.
 */

import { formatPercent, formatPLN } from '@/lib/format'
import { channelName } from './insights'
import { shortLabel } from './sku'
import type { Snapshot } from './snapshot'

export interface ExecutiveBrief {
  /** "Good morning" / "Good afternoon" / "Good evening". */
  greeting: string
  /** The period being described, e.g. "This month so far". */
  scope: string
  /** Opening verdict — the single most important sentence. */
  verdict: string
  /** Supporting sentences, each a complete thought. */
  body: string[]
  /** Count of findings needing attention, for the closing line. */
  attentionCount: number
}

function timeGreeting(now: Date): string {
  const hour = now.getHours()
  if (hour < 12) return 'Good morning'
  if (hour < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Characterises performance against the prior window in plain words. */
function verdictFor(changePct: number | null): string {
  if (changePct === null) return 'steady'
  if (changePct >= 25) return 'well above average'
  if (changePct >= 8) return 'above average'
  if (changePct > -8) return 'in line with the previous period'
  if (changePct > -25) return 'below average'
  return 'well below average'
}

export function buildExecutiveBrief(
  snapshot: Snapshot,
  ownerName?: string,
  now: Date = new Date(),
): ExecutiveBrief {
  const { totals, previousTotals, period, products, channels, insights } = snapshot

  const greeting = ownerName ? `${timeGreeting(now)} ${ownerName}` : timeGreeting(now)
  const scope = period.key === 'all' ? 'All trading to date' : period.label

  const revenueChange =
    previousTotals && previousTotals.revenuePLN > 0
      ? ((totals.revenuePLN - previousTotals.revenuePLN) / previousTotals.revenuePLN) * 100
      : null

  const body: string[] = []

  if (totals.orders === 0) {
    return {
      greeting,
      scope,
      verdict: `No orders have landed in this period yet.`,
      body: ['Widen the snapshot period to see how the business has been trading.'],
      attentionCount: 0,
    }
  }

  // Opening verdict: how it went, in words before numbers.
  const verdict =
    revenueChange === null
      ? `${period.label} brought ${formatPLN(totals.revenuePLN)} of revenue across ${totals.orders} orders.`
      : `${period.label} was ${verdictFor(revenueChange)}.`

  // What actually happened.
  if (revenueChange !== null && previousTotals) {
    const profitChange =
      previousTotals.marginPLN !== 0
        ? ((totals.marginPLN - previousTotals.marginPLN) / Math.abs(previousTotals.marginPLN)) * 100
        : null
    const marginShift = totals.marginPct - previousTotals.marginPct

    const revenuePhrase =
      Math.abs(revenueChange) < 1
        ? 'Revenue held flat'
        : `Revenue ${revenueChange > 0 ? 'increased' : 'fell'} by ${Math.abs(revenueChange).toFixed(0)}%`
    const profitPhrase =
      profitChange === null || Math.abs(profitChange) < 2
        ? 'profit remained stable'
        : `profit ${profitChange > 0 ? 'rose' : 'dropped'} ${Math.abs(profitChange).toFixed(0)}%`
    const marginPhrase =
      Math.abs(marginShift) < 0.5
        ? 'margin was unchanged'
        : `margin ${marginShift > 0 ? 'improved' : 'slipped'} ${Math.abs(marginShift).toFixed(1)} points to ${formatPercent(totals.marginPct)}`

    body.push(`${revenuePhrase}, ${profitPhrase}, and ${marginPhrase}.`)
  } else {
    body.push(
      `${formatPLN(totals.revenuePLN)} of revenue produced ${formatPLN(totals.marginPLN)} of profit, a ${formatPercent(totals.marginPct)} margin.`,
    )
  }

  // Who carried it.
  const leader = products[0]
  if (leader && products.length > 1) {
    body.push(
      `${shortLabel(leader.label, 44)} led the period with ${formatPLN(leader.revenuePLN)} of revenue and ${formatPercent(leader.marginShare * 100, 0)} of all profit.`,
    )
  }

  // Basket behaviour — the quiet metric that explains a lot.
  if (previousTotals && previousTotals.avgOrderValuePLN > 0) {
    const basketChange =
      ((totals.avgOrderValuePLN - previousTotals.avgOrderValuePLN) /
        previousTotals.avgOrderValuePLN) *
      100
    if (Math.abs(basketChange) >= 5) {
      body.push(
        `Customers are spending ${basketChange > 0 ? 'more' : 'less'} per order — the average basket ${basketChange > 0 ? 'rose' : 'fell'} to ${formatPLN(totals.avgOrderValuePLN)}, ${Math.abs(basketChange).toFixed(0)}% ${basketChange > 0 ? 'up' : 'down'}.`,
      )
    }
  }

  // Where it sold. The contrast only reads as a contrast when the biggest
  // channel is not also the best one — otherwise it is simply good news.
  const [first, second] = channels
  if (first && second && first.marginPct !== second.marginPct) {
    const leaderIsBest = first.marginPct >= second.marginPct
    body.push(
      leaderIsBest
        ? `${channelName(first.source)} drove ${formatPercent(first.revenueShare * 100, 0)} of revenue and is also the more profitable channel, at ${formatPercent(first.marginPct)} against ${formatPercent(second.marginPct)}.`
        : `${channelName(first.source)} drove ${formatPercent(first.revenueShare * 100, 0)} of revenue, but ${channelName(second.source)} is the more profitable channel at ${formatPercent(second.marginPct)} versus ${formatPercent(first.marginPct)}.`,
    )
  }

  // What needs a decision.
  const critical = insights.filter((insight) => insight.severity === 'critical').length
  const attention = insights.filter((insight) => insight.severity === 'attention').length
  const opportunities = insights.filter((insight) => insight.kind === 'opportunity').length

  if (critical > 0) {
    body.push(
      `${critical} product${critical === 1 ? '' : 's'} require${critical === 1 ? 's' : ''} attention now, selling at or below cost recovery.`,
    )
  } else if (attention > 0) {
    body.push(`${attention} finding${attention === 1 ? '' : 's'} are worth clearing this week.`)
  }

  if (opportunities > 0) {
    body.push(
      `${opportunities} pricing or scaling opportunit${opportunities === 1 ? 'y has' : 'ies have'} been detected.`,
    )
  }

  return { greeting, scope, verdict, body, attentionCount: critical + attention }
}
