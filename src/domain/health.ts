/**
 * Business Health Score.
 *
 * A single number is only useful if it can be taken apart. Every component here
 * is independently scored, weighted, and explained in plain language, so the
 * founder can always answer "why is it 72?" — a black-box score would be
 * decoration, not intelligence.
 */

import { formatPercent, formatPLN } from '@/lib/format'
import { clamp, ratio, sum } from './parse'
import type {
  ChannelPerformance,
  DataCoverage,
  HealthBand,
  HealthComponent,
  HealthScore,
  LineItem,
  PeriodComparison,
  ProductPerformance,
} from './types'

export interface HealthInput {
  lineItems: readonly LineItem[]
  products: readonly ProductPerformance[]
  channels: readonly ChannelPerformance[]
  comparison: PeriodComparison
  coverage: DataCoverage
  /**
   * Findings the insight engine raised. The score itself does not use these —
   * they exist so the headline cannot claim all is well while a critical
   * warning sits directly beneath it on the same screen.
   */
  criticalFindings?: number
  attentionFindings?: number
}

/** Portfolio margin below this is structurally unhealthy for marketplace retail. */
const MARGIN_FLOOR_PCT = 5
/** Margin at or above this is best-in-class and scores full marks. */
const MARGIN_TARGET_PCT = 45
/** Profit share from a single product beyond this starts to read as fragility. */
const SAFE_CONCENTRATION_PCT = 25
/** Revenue share for a single channel beyond this is dependency, not focus. */
const SAFE_CHANNEL_SHARE_PCT = 60

function band(score: number): HealthBand {
  if (score >= 80) return 'strong'
  if (score >= 65) return 'healthy'
  if (score >= 50) return 'watch'
  return 'at-risk'
}

function headlineFor(score: number, input: HealthInput): string {
  const marginPct = ratio(
    sum(input.lineItems, (line) => line.marginPLN),
    sum(input.lineItems, (line) => line.revenuePLN),
  ) * 100

  const critical = input.criticalFindings ?? 0
  const attention = input.attentionFindings ?? 0
  const open = critical + attention
  const findings = open === 1 ? '1 finding' : `${open} findings`

  switch (band(score)) {
    case 'strong':
      return critical > 0
        ? `Trading is strong at ${formatPercent(marginPct)} margin, but ${critical === 1 ? 'one product is' : `${critical} products are`} selling below cost recovery — worth fixing before it compounds.`
        : open > 0
          ? `Trading is strong at ${formatPercent(marginPct)} margin, with ${findings} worth clearing this week.`
          : `Trading is strong. ${formatPercent(marginPct)} portfolio margin with no structural warnings.`
    case 'healthy':
      return `Fundamentals are sound at ${formatPercent(marginPct)} margin${open > 0 ? `, with ${findings} dragging on profit` : ''}.`
    case 'watch':
      return `Profit is being eroded faster than it is being earned. ${open > 0 ? `${findings} below would move this materially.` : 'Two or three pricing decisions would move this materially.'}`
    case 'at-risk':
      return `Margin structure needs intervention before scaling spend any further.`
  }
}

export function computeHealthScore(input: HealthInput): HealthScore {
  const { lineItems, products, channels, comparison, coverage } = input

  const totalRevenue = sum(lineItems, (line) => line.revenuePLN)
  const totalMargin = sum(lineItems, (line) => line.marginPLN)
  const marginPct = ratio(totalMargin, totalRevenue) * 100

  // 1. Profitability — the anchor. Everything else modulates it.
  const profitability: HealthComponent = {
    key: 'profitability',
    label: 'Profitability',
    weight: 0.3,
    score: clamp(
      ((marginPct - MARGIN_FLOOR_PCT) / (MARGIN_TARGET_PCT - MARGIN_FLOOR_PCT)) * 100,
      0,
      100,
    ),
    value: formatPercent(marginPct),
    detail:
      marginPct >= 35
        ? 'Portfolio margin is comfortably above the marketplace retail benchmark.'
        : marginPct >= 20
          ? 'Portfolio margin is workable but leaves little room for advertising.'
          : 'Portfolio margin is too thin to absorb returns or ad spend.',
  }

  // 2. Momentum — direction of travel over the two most recent equal windows.
  const change = comparison.revenueChangePct
  const momentum: HealthComponent = {
    key: 'momentum',
    label: 'Momentum',
    weight: 0.25,
    score: !comparison.isReliable || change === null ? 50 : clamp(55 + change * 2.25, 0, 100),
    value: !comparison.isReliable || change === null ? 'Not enough history' : `${change > 0 ? '+' : ''}${change.toFixed(1)}%`,
    detail: !comparison.isReliable || change === null
      ? 'Scored neutral until there are two comparable trading windows.'
      : change > 0
        ? `Revenue grew against the previous ${comparison.windowDays} days.`
        : `Revenue fell against the previous ${comparison.windowDays} days.`,
  }

  // 3. Concentration — how much of the profit rests on one product.
  const topMarginShare = Math.max(0, ...products.map((product) => product.marginShare)) * 100
  const concentration: HealthComponent = {
    key: 'concentration',
    label: 'Profit concentration',
    weight: 0.2,
    score: clamp(100 - Math.max(0, topMarginShare - SAFE_CONCENTRATION_PCT) * 2.2, 0, 100),
    value: `${topMarginShare.toFixed(0)}% from one product`,
    detail:
      topMarginShare > 40
        ? 'A single product carries most of the profit — a stockout would be material.'
        : 'Profit is spread across enough products to absorb a single product stalling.',
  }

  // 4. Channel balance — dependency on one marketplace.
  const topChannelShare = Math.max(0, ...channels.map((channel) => channel.revenueShare)) * 100
  const channelBalance: HealthComponent = {
    key: 'channel-balance',
    label: 'Channel balance',
    weight: 0.1,
    score: clamp(100 - Math.max(0, topChannelShare - SAFE_CHANNEL_SHARE_PCT) * 2.5, 0, 100),
    value: `${topChannelShare.toFixed(0)}% from one channel`,
    detail:
      topChannelShare > 70
        ? 'Most revenue depends on a single marketplace and its policy changes.'
        : 'Revenue is spread across marketplaces well enough to absorb a policy change.',
  }

  // 5. Data integrity — confidence in every number above.
  const integrityScore = coverage.costCoverage * 100 -
    (coverage.totalLineItems - coverage.completeLineItems) * 2
  const dataIntegrity: HealthComponent = {
    key: 'data-integrity',
    label: 'Data confidence',
    weight: 0.15,
    score: clamp(integrityScore, 0, 100),
    value: formatPercent(coverage.costCoverage * 100, 0),
    detail:
      coverage.linesMissingCost > 0
        ? `${formatPLN(coverage.revenueMissingCostPLN)} of revenue has no landed cost on file, so its profit is overstated.`
        : 'Every order is matched to a landed cost.',
  }

  const components = [profitability, momentum, concentration, channelBalance, dataIntegrity]
  const score = Math.round(
    components.reduce((total, component) => total + component.score * component.weight, 0),
  )

  return {
    score,
    band: band(score),
    headline: headlineFor(score, input),
    components,
  }
}
