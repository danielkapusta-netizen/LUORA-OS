/**
 * Insight engine — the difference between reporting and advice.
 *
 * Each rule inspects the derived business context and either fires with a
 * quantified finding or stays silent. Rules never speculate: if the evidence
 * cannot be expressed as a number, the rule does not fire.
 *
 * House rules for every insight:
 *   `why`    must cite the figure that triggered it
 *   `action` must be something the founder can do this week
 *   `impact` must be money, not a score
 */

import { formatPercent, formatPLN } from '@/lib/format'
import { ratio, sum } from './parse'
import { shortLabel } from './sku'
import type {
  ChannelPerformance,
  DataCoverage,
  Insight,
  LineItem,
  PeriodComparison,
  ProductPerformance,
} from './types'

export interface InsightInput {
  lineItems: readonly LineItem[]
  products: readonly ProductPerformance[]
  channels: readonly ChannelPerformance[]
  comparison: PeriodComparison
  coverage: DataCoverage
}

/** A product earning less than this is diluting the portfolio. */
const THIN_MARGIN_PCT = 15
/** Below this, an order is effectively working for the marketplace, not Luora. */
const CRITICAL_MARGIN_PCT = 8
/** Ignore rounding-error products when hunting for leaks. */
const MATERIAL_REVENUE_SHARE = 0.02
/** Channel margin gaps narrower than this are noise. */
const MATERIAL_CHANNEL_GAP_PP = 4
/** Revenue swings smaller than this are not worth waking the founder for. */
const MATERIAL_MOMENTUM_PCT = 12
/** Fewer orders than this is an anecdote, not demand worth spending against. */
const MIN_ORDERS_FOR_CONFIDENCE = 3

const CHANNEL_NAMES: Record<string, string> = {
  allegro: 'Allegro',
  empik: 'Empik',
}

export function channelName(source: string): string {
  return CHANNEL_NAMES[source] ?? source.charAt(0).toUpperCase() + source.slice(1)
}

export function generateInsights(input: InsightInput): Insight[] {
  const { lineItems, products, channels, comparison, coverage } = input
  const insights: Insight[] = []

  const totalRevenue = sum(lineItems, (line) => line.revenuePLN)
  const totalMargin = sum(lineItems, (line) => line.marginPLN)
  const portfolioMarginPct = ratio(totalMargin, totalRevenue) * 100

  // ── Rule 1 ── Margin leak: material products earning far below portfolio rate.
  for (const product of products) {
    if (product.revenueShare < MATERIAL_REVENUE_SHARE) continue
    if (product.marginPct >= THIN_MARGIN_PCT) continue

    const forgone = (product.revenuePLN * (portfolioMarginPct - product.marginPct)) / 100
    insights.push({
      id: `margin-leak:${product.productKey}`,
      kind: 'risk',
      severity: product.marginPct < CRITICAL_MARGIN_PCT ? 'critical' : 'attention',
      title: `${shortLabel(product.label, 40)} is selling at ${formatPercent(product.marginPct)} margin`,
      why: `It has taken ${product.orders} orders and ${formatPLN(product.revenuePLN)} of revenue, but returns only ${formatPLN(product.marginPLN)} of profit — against a portfolio average of ${formatPercent(portfolioMarginPct)}.`,
      action:
        product.marginPct < CRITICAL_MARGIN_PCT
          ? 'Raise the listing price or renegotiate landed cost before promoting this further. At this margin, more volume makes the problem bigger.'
          : 'Test a price increase of 8–12%. Demand is proven, so the risk is asymmetric in your favour.',
      impactPLN: forgone,
      impactLabel: 'profit forgone at current volume',
      entity: { type: 'product', key: product.productKey, label: product.label },
    })
  }

  // ── Rule 2 ── Concentration: too much profit resting on one product.
  const leader = products[0]
  const topByMargin = [...products].sort((a, b) => b.marginShare - a.marginShare)[0]
  if (topByMargin && topByMargin.marginShare > 0.3) {
    insights.push({
      id: `concentration:${topByMargin.productKey}`,
      kind: 'risk',
      severity: topByMargin.marginShare > 0.45 ? 'critical' : 'attention',
      title: `${formatPercent(topByMargin.marginShare * 100, 0)} of all profit comes from one product`,
      why: `${shortLabel(topByMargin.label, 44)} generates ${formatPLN(topByMargin.marginPLN)} of your ${formatPLN(totalMargin)} total profit. A stockout, delisting, or price war on this single listing would take most of the business with it.`,
      action:
        'Secure inventory cover on this SKU first, then push the next two highest-margin products with the advertising budget you would otherwise spend here.',
      impactPLN: topByMargin.marginPLN,
      impactLabel: 'profit exposed to a single listing',
      entity: { type: 'product', key: topByMargin.productKey, label: topByMargin.label },
    })
  }

  // ── Rule 3 ── Unknown cost base: profit figures that cannot be trusted.
  if (coverage.linesMissingCost > 0) {
    insights.push({
      id: 'cost-coverage',
      kind: 'risk',
      severity: coverage.costCoverage < 0.9 ? 'attention' : 'info',
      title: `${coverage.linesMissingCost} orders have no landed cost on file`,
      why: `${formatPLN(coverage.revenueMissingCostPLN)} of revenue is matched to no cost record, so its margin is reported without COGS and is overstated. These orders currently average a far higher margin than the rest of the book — that gap is a data artefact, not performance.`,
      action:
        'Add landed costs for these listings in the product cost sheet. Until then, treat their profit as unverified.',
      impactPLN: coverage.revenueMissingCostPLN,
      impactLabel: 'revenue at unverified profitability',
    })
  }

  // ── Rule 4 ── Channel margin gap: same catalogue, different profitability.
  if (channels.length >= 2) {
    const sorted = [...channels].sort((a, b) => b.marginPct - a.marginPct)
    const best = sorted[0]
    const worst = sorted[sorted.length - 1]
    if (best && worst && best.source !== worst.source) {
      const gap = best.marginPct - worst.marginPct
      if (gap >= MATERIAL_CHANNEL_GAP_PP) {
        insights.push({
          id: `channel-gap:${worst.source}`,
          kind: 'opportunity',
          severity: 'attention',
          title: `${channelName(best.source)} converts revenue into profit ${gap.toFixed(1)}pp better than ${channelName(worst.source)}`,
          why: `${channelName(best.source)} runs at ${formatPercent(best.marginPct)} margin against ${formatPercent(worst.marginPct)} on ${channelName(worst.source)}, on ${worst.orders} orders and ${formatPLN(worst.revenuePLN)} of revenue.`,
          action: `Shift promotional budget toward ${channelName(best.source)}, and review commission and shipping assumptions on ${channelName(worst.source)} before committing more volume there.`,
          impactPLN: (worst.revenuePLN * gap) / 100,
          impactLabel: `additional profit if ${channelName(worst.source)} matched ${channelName(best.source)}`,
          entity: { type: 'channel', key: worst.source, label: channelName(worst.source) },
        })
      }
    }
  }

  // ── Rule 5 ── Under-scaled winners: proven margin that volume has not caught
  // up with. Demand must be repeatable — recommending ad spend off a single
  // sale is noise dressed as advice, so the rule requires a real order history.
  const candidates = products
    .filter(
      (product) =>
        !product.costUnknown &&
        product.marginPct >= portfolioMarginPct + 8 &&
        product.orders >= MIN_ORDERS_FOR_CONFIDENCE &&
        product.revenueShare < 0.1 &&
        product.marginPLN > 0,
    )
    .sort((a, b) => b.marginPLN - a.marginPLN)
    .slice(0, 2)

  for (const product of candidates) {
    const orderWord = product.orders === 1 ? 'order' : 'orders'
    insights.push({
      id: `under-scaled:${product.productKey}`,
      kind: 'opportunity',
      severity: 'info',
      title: `${shortLabel(product.label, 40)} earns ${formatPercent(product.marginPct)} margin on just ${product.orders} ${orderWord}`,
      why: `It returns ${formatPLN(product.marginPLN / Math.max(1, product.orders))} of profit per order — well above your ${formatPercent(portfolioMarginPct)} portfolio average — yet carries only ${formatPercent(product.revenueShare * 100)} of revenue. That margin headroom makes paid traffic affordable here in a way it is not on your volume products.`,
      action:
        'Move the advertising budget currently going to your thin-margin listings here, and check the title and photography match your bestseller.',
      impactPLN: product.marginPLN,
      impactLabel: 'additional profit if volume doubles',
      entity: { type: 'product', key: product.productKey, label: product.label },
    })
  }

  // ── Rule 6 ── Momentum shift worth acting on.
  if (comparison.isReliable && comparison.revenueChangePct !== null) {
    const change = comparison.revenueChangePct
    if (Math.abs(change) >= MATERIAL_MOMENTUM_PCT) {
      const growing = change > 0
      insights.push({
        id: 'momentum',
        kind: growing ? 'opportunity' : 'risk',
        severity: growing ? 'info' : 'attention',
        title: growing
          ? `Revenue is up ${change.toFixed(1)}% over the last ${comparison.windowDays} days`
          : `Revenue is down ${Math.abs(change).toFixed(1)}% over the last ${comparison.windowDays} days`,
        why: `${formatPLN(comparison.current.revenuePLN)} across ${comparison.current.orders} orders, against ${formatPLN(comparison.previous.revenuePLN)} from ${comparison.previous.orders} orders in the ${comparison.windowDays} days before.`,
        action: growing
          ? 'Confirm inventory cover on your top three listings before this demand outruns stock.'
          : 'Check listing visibility and competitor pricing on your top listings — a ranking drop shows up here before it shows up in the monthly numbers.',
        impactPLN: Math.abs(comparison.current.revenuePLN - comparison.previous.revenuePLN),
        impactLabel: `revenue swing per ${comparison.windowDays} days`,
      })
    }
  }

  // ── Rule 7 ── Rows the pipeline could not read.
  const incomplete = coverage.totalLineItems - coverage.completeLineItems
  if (incomplete > 0) {
    insights.push({
      id: 'incomplete-rows',
      kind: 'risk',
      severity: 'info',
      title: `${incomplete} order${incomplete === 1 ? '' : 's'} could not be fully read`,
      why: `${incomplete} row${incomplete === 1 ? ' is' : 's are'} missing the PLN price or margin needed to include ${incomplete === 1 ? 'it' : 'them'} in profit totals. Every figure in Luora excludes ${incomplete === 1 ? 'it' : 'them'}.`,
      action: 'Fill the missing currency conversion in the source sheet so these orders re-enter the numbers.',
      impactPLN: null,
      impactLabel: null,
    })
  }

  // ── Rule 8 ── Volume concentrated in near-zero-margin sales.
  const thinLines = lineItems.filter(
    (line) => line.marginPct !== null && line.marginPct < CRITICAL_MARGIN_PCT,
  )
  if (thinLines.length > 0 && thinLines.length / Math.max(1, lineItems.length) > 0.1) {
    const thinRevenue = sum(thinLines, (line) => line.revenuePLN)
    insights.push({
      id: 'thin-order-share',
      kind: 'risk',
      severity: 'attention',
      title: `${formatPercent((thinLines.length / lineItems.length) * 100, 0)} of items sell under ${CRITICAL_MARGIN_PCT}% margin`,
      why: `${thinLines.length} of ${lineItems.length} product lines returned less than ${CRITICAL_MARGIN_PCT}% profit, on ${formatPLN(thinRevenue)} of revenue. These consume the same packing, shipping and support effort as your profitable ones.`,
      action:
        'Reprice or retire the listings behind these orders. Fulfilment capacity spent here is capacity not spent on your high-margin catalogue.',
      impactPLN: (thinRevenue * (portfolioMarginPct - CRITICAL_MARGIN_PCT)) / 100,
      impactLabel: 'profit forgone versus portfolio average',
    })
  }

  // Two listings of the same product would otherwise raise the same advice
  // twice. Root-cause deduplication happens in `skuKey`; this is the backstop.
  const seen = new Set<string>()
  const unique = insights.filter((insight) => {
    if (seen.has(insight.title)) return false
    seen.add(insight.title)
    return true
  })

  // Leader context is used to break ties toward the products that matter most.
  const severityRank: Record<Insight['severity'], number> = { critical: 0, attention: 1, info: 2 }
  return unique.sort((a, b) => {
    const bySeverity = severityRank[a.severity] - severityRank[b.severity]
    if (bySeverity !== 0) return bySeverity
    const aLeads = a.entity?.key === leader?.productKey ? 1 : 0
    const bLeads = b.entity?.key === leader?.productKey ? 1 : 0
    if (aLeads !== bLeads) return bLeads - aLeads
    return (b.impactPLN ?? 0) - (a.impactPLN ?? 0)
  })
}
