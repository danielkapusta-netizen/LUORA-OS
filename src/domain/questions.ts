/**
 * Executive Questions — the questions a founder actually asks, answered.
 *
 * Each answer is a small analysis, not a metric lookup. The hard one is "what
 * made me less money than expected": knowing profit fell is easy, knowing
 * *why* means decomposing the change into price, commission, shipping and
 * landed cost. Because the sheet stores those per line, that decomposition is
 * real arithmetic rather than a guess.
 *
 * Every answer that cannot be supported by the data returns `null` and the card
 * is not rendered. A question answered with a shrug is worse than no card.
 */

import { formatPercent, formatPLN } from '@/lib/format'
import { ratio, sum } from './parse'
import { shortLabel } from './sku'
import type { Snapshot } from './snapshot'
import type { Confidence, LineItem, ProductPerformance } from './types'

export type QuestionTone = 'positive' | 'negative' | 'neutral' | 'opportunity'

export interface QuestionAnswer {
  id: string
  /** The question, phrased as the founder would ask it. */
  question: string
  /** The answer in one line — usually a product name or a verdict. */
  headline: string
  /** The supporting figure, displayed large. */
  metric: string
  metricCaption: string
  /** Why this is the answer, in plain language. */
  explanation: string
  /** What to do about it, when there is something to do. */
  recommendation?: string
  tone: QuestionTone
  confidence?: Confidence
  entity?: { type: 'product'; key: string; label: string }
}

/** Below this many orders a per-product comparison is anecdote, not signal. */
const MIN_ORDERS_FOR_SIGNAL = 4

/** Per-unit economics of one product inside a window, for attribution. */
interface UnitEconomics {
  units: number
  orders: number
  revenuePerUnit: number
  commissionPerUnit: number
  shippingPerUnit: number
  /** Everything not explained by commission or shipping — i.e. landed cost. */
  costPerUnit: number
  profitPerUnit: number
  marginPct: number
}

function unitEconomics(lines: readonly LineItem[]): UnitEconomics | null {
  const units = sum(lines, (line) => line.qty)
  if (units <= 0) return null
  const revenue = sum(lines, (line) => line.revenuePLN)
  const commission = sum(lines, (line) => line.commissionPLN)
  const shipping = sum(lines, (line) => line.shipmentPLN)
  const profit = sum(lines, (line) => line.marginPLN)
  // Residual: revenue − commission − shipping − profit is what the goods cost.
  const cost = revenue - commission - shipping - profit
  return {
    units,
    orders: lines.length,
    revenuePerUnit: revenue / units,
    commissionPerUnit: commission / units,
    shippingPerUnit: shipping / units,
    costPerUnit: cost / units,
    profitPerUnit: profit / units,
    marginPct: ratio(profit, revenue) * 100,
  }
}

function linesByProduct(lines: readonly LineItem[]): Map<string, LineItem[]> {
  const map = new Map<string, LineItem[]>()
  for (const line of lines) {
    const existing = map.get(line.productKey)
    if (existing) existing.push(line)
    else map.set(line.productKey, [line])
  }
  return map
}

function confidenceFor(orders: number): Confidence {
  if (orders >= 20) return 'high'
  if (orders >= 8) return 'medium'
  return 'low'
}

/* ── Q1 ── What made me the most money? ─────────────────────────────────── */
function topEarner(snapshot: Snapshot): QuestionAnswer | null {
  const ranked = [...snapshot.products].sort((a, b) => b.marginPLN - a.marginPLN)
  const winner = ranked[0]
  if (!winner || winner.marginPLN <= 0) return null

  const runnerUp = ranked[1]
  const lead =
    runnerUp && runnerUp.marginPLN > 0
      ? ` That is ${formatPLN(winner.marginPLN - runnerUp.marginPLN)} more than the next best, ${shortLabel(runnerUp.label, 34)}.`
      : ''

  return {
    id: 'top-earner',
    question: 'What made me the most money?',
    headline: shortLabel(winner.label, 52),
    metric: formatPLN(winner.marginPLN),
    metricCaption: `${formatPercent(winner.marginShare * 100, 0)} of all profit`,
    explanation: `${winner.orders} orders at ${formatPercent(winner.marginPct)} margin produced ${formatPLN(winner.marginPLN)} of profit on ${formatPLN(winner.revenuePLN)} of revenue.${lead}`,
    tone: 'positive',
    confidence: confidenceFor(winner.orders),
    entity: { type: 'product', key: winner.productKey, label: winner.label },
  }
}

/* ── Q2 ── What made me less than expected, and why? ─────────────────────── */
function underperformer(snapshot: Snapshot): QuestionAnswer | null {
  if (!snapshot.previousTotals) return null

  const currentLines = linesByProduct(snapshot.lineItems)
  const previousLines = linesByProduct(snapshot.previousOrders.flatMap((order) => order.items))

  let worst: {
    product: ProductPerformance
    now: UnitEconomics
    before: UnitEconomics
    profitDrop: number
  } | null = null

  for (const product of snapshot.products) {
    if (product.orders < MIN_ORDERS_FOR_SIGNAL) continue
    const now = unitEconomics(currentLines.get(product.productKey) ?? [])
    const before = unitEconomics(previousLines.get(product.productKey) ?? [])
    if (!now || !before || before.orders < MIN_ORDERS_FOR_SIGNAL) continue

    // Profit lost at current volume because per-unit economics worsened.
    const profitDrop = (before.profitPerUnit - now.profitPerUnit) * now.units
    if (profitDrop <= 0) continue
    if (!worst || profitDrop > worst.profitDrop) {
      worst = { product, now, before, profitDrop }
    }
  }

  if (!worst) return null

  const { product, now, before, profitDrop } = worst

  // Decompose the per-unit profit change into its four drivers.
  const drivers: Array<{ label: string; delta: number }> = [
    { label: 'selling price', delta: now.revenuePerUnit - before.revenuePerUnit },
    { label: 'marketplace commission', delta: -(now.commissionPerUnit - before.commissionPerUnit) },
    { label: 'shipping', delta: -(now.shippingPerUnit - before.shippingPerUnit) },
    { label: 'product cost', delta: -(now.costPerUnit - before.costPerUnit) },
  ]
  const hurting = drivers
    .filter((driver) => driver.delta < -0.01)
    .sort((a, b) => a.delta - b.delta)

  const primary = hurting[0]
  const cause = primary
    ? `${primary.label} moved against you by ${formatPLN(Math.abs(primary.delta))} per unit`
    : 'the mix of orders shifted toward lower-margin sales'
  const secondary =
    hurting[1] && Math.abs(hurting[1].delta) > 0.05
      ? `, with ${hurting[1].label} costing a further ${formatPLN(Math.abs(hurting[1].delta))} per unit`
      : ''

  return {
    id: 'underperformer',
    question: 'What made me less money than expected?',
    headline: shortLabel(product.label, 52),
    metric: formatPLN(profitDrop),
    metricCaption: 'profit lost versus the previous window',
    explanation: `Profit per unit fell from ${formatPLN(before.profitPerUnit)} to ${formatPLN(now.profitPerUnit)} because ${cause}${secondary}. Margin went from ${formatPercent(before.marginPct)} to ${formatPercent(now.marginPct)}.`,
    recommendation: primary?.label === 'product cost'
      ? 'Check the supplier invoice behind this cost change before reordering.'
      : primary?.label === 'selling price'
        ? 'Review whether the discount that moved this price is still earning its volume.'
        : 'Review the listing’s fee and delivery configuration on the marketplace.',
    tone: 'negative',
    confidence: confidenceFor(Math.min(now.orders, before.orders)),
    entity: { type: 'product', key: product.productKey, label: product.label },
  }
}

/* ── Q3 ── Which product is quietly getting worse? ───────────────────────── */
function quietDecline(snapshot: Snapshot): QuestionAnswer | null {
  if (!snapshot.previousTotals) return null
  const previousByKey = new Map(
    snapshot.previousProducts.map((product) => [product.productKey, product]),
  )

  let worst: { product: ProductPerformance; marginDrop: number; revenueChange: number } | null = null

  for (const product of snapshot.products) {
    if (product.orders < MIN_ORDERS_FOR_SIGNAL) continue
    const before = previousByKey.get(product.productKey)
    if (!before || before.orders < MIN_ORDERS_FOR_SIGNAL) continue

    const revenueChange = ratio(product.revenuePLN - before.revenuePLN, before.revenuePLN) * 100
    const marginDrop = before.marginPct - product.marginPct

    // The quiet case: revenue holding steady while margin erodes underneath.
    if (Math.abs(revenueChange) > 20 || marginDrop < 2) continue
    if (!worst || marginDrop > worst.marginDrop) {
      worst = { product, marginDrop, revenueChange }
    }
  }

  if (!worst) return null
  const { product, marginDrop, revenueChange } = worst
  const before = previousByKey.get(product.productKey)!

  return {
    id: 'quiet-decline',
    question: 'Which product is quietly getting worse?',
    headline: shortLabel(product.label, 52),
    metric: `−${marginDrop.toFixed(1)}pp`,
    metricCaption: 'margin, on flat revenue',
    explanation: `Revenue barely moved (${revenueChange >= 0 ? '+' : ''}${revenueChange.toFixed(1)}%) so nothing looks wrong on the top line — but margin slipped from ${formatPercent(before.marginPct)} to ${formatPercent(product.marginPct)}, taking ${formatPLN(before.marginPLN - product.marginPLN)} of profit with it.`,
    recommendation: 'Review pricing and supplier cost on this listing before the erosion compounds.',
    tone: 'negative',
    confidence: confidenceFor(product.orders),
    entity: { type: 'product', key: product.productKey, label: product.label },
  }
}

/* ── Q4 ── Which product deserves more attention? ────────────────────────── */
function risingStar(snapshot: Snapshot): QuestionAnswer | null {
  const previousByKey = new Map(
    snapshot.previousProducts.map((product) => [product.productKey, product]),
  )
  const portfolioMargin = snapshot.totals.marginPct

  let best: { product: ProductPerformance; growth: number } | null = null

  for (const product of snapshot.products) {
    if (product.orders < MIN_ORDERS_FOR_SIGNAL) continue
    if (product.marginPct < portfolioMargin) continue
    const before = previousByKey.get(product.productKey)
    // The baseline must be substantial too. Growth measured against one or two
    // stray orders produces four-digit percentages that mean nothing — a
    // product going from 2 orders to 30 is a launch, not a trend to chase.
    if (!before || before.orders < MIN_ORDERS_FOR_SIGNAL || before.revenuePLN <= 0) continue
    const growth = ratio(product.revenuePLN - before.revenuePLN, before.revenuePLN) * 100
    if (growth < 15) continue
    if (!best || growth > best.growth) best = { product, growth }
  }

  if (!best) return null
  const { product, growth } = best

  return {
    id: 'rising-star',
    question: 'Which product deserves more attention?',
    headline: shortLabel(product.label, 52),
    metric: `+${growth.toFixed(0)}%`,
    metricCaption: 'revenue growth, margin intact',
    explanation: `Revenue grew ${growth.toFixed(0)}% across ${product.orders} orders while holding ${formatPercent(product.marginPct)} margin — above your ${formatPercent(portfolioMargin)} portfolio average. Growth that does not cost margin is the rarest kind.`,
    recommendation: 'Secure inventory cover, then put marketing behind it while the momentum is real.',
    tone: 'opportunity',
    confidence: confidenceFor(product.orders),
    entity: { type: 'product', key: product.productKey, label: product.label },
  }
}

/* ── Q5 ── Where would one pricing change do the most? ───────────────────── */
function pricingOpportunity(snapshot: Snapshot): QuestionAnswer | null {
  const portfolioMargin = snapshot.totals.marginPct
  const candidates = snapshot.products.filter(
    (product) =>
      product.orders >= MIN_ORDERS_FOR_SIGNAL &&
      product.marginPct < portfolioMargin &&
      product.revenuePLN > 0,
  )
  if (candidates.length === 0) return null

  // A 5% list-price rise flows almost entirely to profit: commission scales
  // with price, landed cost does not. Modelled conservatively at 90% pass-through.
  const uplift = 0.05
  const passThrough = 0.9

  const scored = candidates
    .map((product) => ({
      product,
      gain: product.revenuePLN * uplift * passThrough,
      newMargin:
        ratio(product.marginPLN + product.revenuePLN * uplift * passThrough, product.revenuePLN * (1 + uplift)) *
        100,
    }))
    .sort((a, b) => b.gain - a.gain)

  const best = scored[0]
  if (!best || best.gain <= 0) return null

  const periodDays = Math.max(1, snapshot.period.days)
  const monthlyGain = (best.gain / periodDays) * 30

  return {
    id: 'pricing-opportunity',
    question: 'Where could one pricing change do the most?',
    headline: shortLabel(best.product.label, 52),
    metric: formatPLN(monthlyGain),
    metricCaption: 'estimated additional profit per month',
    explanation: `It sells at ${formatPercent(best.product.marginPct)} margin — below your ${formatPercent(portfolioMargin)} average — on ${best.product.orders} orders and ${formatPLN(best.product.revenuePLN)} of revenue. A 5% price rise would lift its margin to roughly ${formatPercent(best.newMargin)}, since commission scales with price but landed cost does not.`,
    recommendation: `Raise the listing price 5% and watch conversion for a week. Demand is already proven at ${formatPLN(best.product.avgUnitPricePLN)} per unit.`,
    tone: 'opportunity',
    confidence: confidenceFor(best.product.orders),
    entity: { type: 'product', key: best.product.productKey, label: best.product.label },
  }
}

/* ── Q6 ── Healthier, or just larger? ────────────────────────────────────── */
function healthierOrLarger(snapshot: Snapshot): QuestionAnswer | null {
  const previous = snapshot.previousTotals
  if (!previous || previous.revenuePLN <= 0 || previous.marginPLN === 0) return null

  const revenueGrowth = ratio(snapshot.totals.revenuePLN - previous.revenuePLN, previous.revenuePLN) * 100
  const profitGrowth = ratio(snapshot.totals.marginPLN - previous.marginPLN, Math.abs(previous.marginPLN)) * 100
  const marginShift = snapshot.totals.marginPct - previous.marginPct

  const growing = revenueGrowth > 1
  const profitOutpacing = profitGrowth >= revenueGrowth

  let headline: string
  let tone: QuestionTone
  let explanation: string
  let recommendation: string | undefined

  if (growing && profitOutpacing) {
    headline = 'Healthier — profit is outgrowing revenue'
    tone = 'positive'
    explanation = `Revenue grew ${revenueGrowth.toFixed(1)}% while profit grew ${profitGrowth.toFixed(1)}%, lifting margin ${marginShift >= 0 ? 'up' : 'down'} ${Math.abs(marginShift).toFixed(1)} points to ${formatPercent(snapshot.totals.marginPct)}. You are keeping more of every złoty you sell.`
  } else if (growing && !profitOutpacing) {
    headline = 'Larger, not healthier'
    tone = 'negative'
    explanation = `Revenue grew ${revenueGrowth.toFixed(1)}% but profit only ${profitGrowth.toFixed(1)}%, so margin fell ${Math.abs(marginShift).toFixed(1)} points to ${formatPercent(snapshot.totals.marginPct)}. The extra volume is arriving at a worse rate than the business already earns.`
    recommendation = 'Find which products drove the extra volume and check what they earn — growth bought with margin is rented, not owned.'
  } else if (!growing && marginShift > 0) {
    headline = 'Smaller but healthier'
    tone = 'neutral'
    explanation = `Revenue fell ${Math.abs(revenueGrowth).toFixed(1)}% while margin improved ${marginShift.toFixed(1)} points to ${formatPercent(snapshot.totals.marginPct)}. You are trading less but keeping more of it.`
  } else {
    headline = 'Contracting on both counts'
    tone = 'negative'
    explanation = `Revenue fell ${Math.abs(revenueGrowth).toFixed(1)}% and margin fell ${Math.abs(marginShift).toFixed(1)} points to ${formatPercent(snapshot.totals.marginPct)}. Volume and profitability are moving down together.`
    recommendation = 'Treat this as the priority: the Action Centre lists the specific products behind it.'
  }

  return {
    id: 'healthier-or-larger',
    question: 'Is my business becoming healthier, or just larger?',
    headline,
    metric: `${profitGrowth >= 0 ? '+' : ''}${profitGrowth.toFixed(1)}%`,
    metricCaption: `profit growth vs ${revenueGrowth >= 0 ? '+' : ''}${revenueGrowth.toFixed(1)}% revenue`,
    explanation,
    ...(recommendation ? { recommendation } : {}),
    tone,
    confidence: snapshot.totals.orders >= 20 ? 'high' : 'medium',
  }
}

export function buildExecutiveQuestions(snapshot: Snapshot): QuestionAnswer[] {
  return [
    topEarner(snapshot),
    healthierOrLarger(snapshot),
    underperformer(snapshot),
    quietDecline(snapshot),
    risingStar(snapshot),
    pricingOpportunity(snapshot),
  ].filter((answer): answer is QuestionAnswer => answer !== null)
}
