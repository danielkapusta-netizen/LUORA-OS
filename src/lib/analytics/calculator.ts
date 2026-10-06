/**
 * Margin Calculator — the sourcing decision, before any sales exist.
 *
 * Every other pricing surface in Luora looks backwards: it takes a product
 * that has already sold and asks whether it was priced correctly. This module
 * answers the question that comes first — "I am looking at a supplier quote
 * right now; if I buy at this cost and list at this price, do I make money?"
 *
 * It deliberately reuses the forward model from `pricing.ts` rather than
 * restating it. That model was verified against ~3,700 live rows:
 *
 *     profit(P) = P/1.23 − commRate·P − landedCost
 *
 * Sharing it is not just tidiness. A product evaluated here and later sold
 * must report the same margin on the Pricing page; two formulas would
 * eventually disagree on the same screen and neither number would be
 * trustworthy.
 *
 * Two inversions turn that pricing model into a sourcing tool:
 *
 *   - the break-even price — what you must charge to not lose money, and
 *   - the **maximum payable cost** — the number to walk into a negotiation
 *     with. Solving `margin = profit/P` for cost gives
 *     `maxCost = P · (NET − comm − targetMargin)`, which says exactly how
 *     much room a quote has before the listing stops being worth stocking.
 *
 * What is *not* modelled: outbound shipping to the customer. `profitAt` does
 * not deduct it and neither does the waterfall, so including it here would
 * make this page disagree with every other one. Inbound freight and duty are
 * different — they are part of landed cost by definition, which is what
 * `ProductCost.totalCostPLN` already means.
 */

import {
  NET,
  classifyMargin,
  marginAt,
  priceForMargin,
  profitAt,
  statusFor,
  toCharmPrice,
  type MarginHealth,
  type MarginTarget,
  type PriceStatus,
  type WaterfallStep,
} from './pricing'
import { ratio, sum } from './parse'
import type { Channel, Order, ProductPerformance } from './types'

/** Currencies a Korean-skincare quote realistically arrives in. */
export type SourceCurrency = 'PLN' | 'USD' | 'EUR' | 'KRW'

export const SOURCE_CURRENCIES: Array<{ value: SourceCurrency; label: string; symbol: string }> = [
  { value: 'PLN', label: 'PLN', symbol: 'zł' },
  { value: 'USD', label: 'USD', symbol: '$' },
  { value: 'EUR', label: 'EUR', symbol: '€' },
  { value: 'KRW', label: 'KRW', symbol: '₩' },
]

/**
 * The margin a new listing should clear to be worth stocking.
 *
 * 18%, not 15%, for the same reason `buildRecommendation` targets 18%: the
 * healthy line is 15%, and a product sourced to land exactly on it returns to
 * the at-risk list the first time freight or the exchange rate moves.
 */
export const TARGET_MARGIN = 0.18

/** Commission fallback when a channel has no measurable history. */
const DEFAULT_COMMISSION_RATE = 0.15

const CALCULATOR_TARGETS = [0, 0.05, 0.1, 0.15, 0.18, 0.2, 0.25]

/* ── inputs ─────────────────────────────────────────────────────────────── */

/**
 * Cost as a supplier actually quotes it, rather than as a single number the
 * founder has to assemble in their head first. Splitting it also shows which
 * component is eating the margin — freight and duty are frequently the reason
 * a cheap-looking unit price does not work.
 */
export interface CostInput {
  /** Unit price as quoted, in `currency`. */
  supplierUnitPrice: number
  currency: SourceCurrency
  /** PLN per 1 unit of `currency`. Always 1 when `currency` is PLN. */
  fxRateToPLN: number
  /** Inbound freight attributed to one unit, in PLN. */
  inboundFreightPLN: number
  /** Duty, customs or import handling per unit, in PLN. */
  dutyPLN: number
}

export interface Candidate {
  id: string
  label: string
  cost: CostInput
  sellingPricePLN: number
  channel: Channel
  /** Percentage override; null means "use the rate measured for this channel". */
  commissionRatePct: number | null
}

export function emptyCandidate(id: string): Candidate {
  return {
    id,
    label: '',
    cost: {
      supplierUnitPrice: 0,
      currency: 'PLN',
      fxRateToPLN: 1,
      inboundFreightPLN: 0,
      dutyPLN: 0,
    },
    sellingPricePLN: 0,
    channel: 'allegro',
    commissionRatePct: null,
  }
}

/* ── landed cost ────────────────────────────────────────────────────────── */

/** Supplier price converted to PLN, plus everything spent getting it here. */
export function landedCost(cost: CostInput): number {
  const converted = cost.supplierUnitPrice * (cost.currency === 'PLN' ? 1 : cost.fxRateToPLN)
  return converted + cost.inboundFreightPLN + cost.dutyPLN
}

/** The three components of landed cost, for display. */
export interface CostParts {
  goodsPLN: number
  freightPLN: number
  dutyPLN: number
  totalPLN: number
}

export function costParts(cost: CostInput): CostParts {
  const goods = cost.supplierUnitPrice * (cost.currency === 'PLN' ? 1 : cost.fxRateToPLN)
  return {
    goodsPLN: goods,
    freightPLN: cost.inboundFreightPLN,
    dutyPLN: cost.dutyPLN,
    totalPLN: goods + cost.inboundFreightPLN + cost.dutyPLN,
  }
}

/* ── the sourcing inversion ─────────────────────────────────────────────── */

/**
 * The most you can pay per unit and still clear `targetMargin` at price `P`.
 *
 * This is the negotiation number: everything above it is a quote to push back
 * on. Returns null when the price cannot reach the margin at any cost at all,
 * which means the listing price is the problem, not the supplier.
 */
export function maxCostForMargin(
  priceGross: number,
  commissionRate: number,
  targetMargin: number,
): number | null {
  if (priceGross <= 0) return null
  const ceiling = priceGross * (NET - commissionRate - targetMargin)
  return ceiling > 0 ? ceiling : null
}

/* ── measured commission ────────────────────────────────────────────────── */

export interface ChannelRate {
  channel: Channel
  rate: number
  /** False when no completed lines existed and the fallback was used. */
  measured: boolean
  /** Lines the rate was measured from — the weight behind it. */
  sampleLines: number
}

/**
 * Commission per channel, measured from real sales rather than assumed.
 *
 * Same ratio `buildPricingWorkspace` uses per product — commission over gross
 * revenue — but aggregated per marketplace, because a product with no history
 * has no rate of its own. Using the founder's own realised rates means the
 * projection stays correct as their fee tiers change, which a hardcoded
 * constant would not.
 */
export function channelCommissionRates(orders: readonly Order[]): Record<Channel, ChannelRate> {
  const totals = new Map<Channel, { revenue: number; commission: number; lines: number }>()

  for (const order of orders) {
    for (const line of order.items) {
      if (!line.isComplete || line.revenuePLN <= 0) continue
      const bucket = totals.get(line.source) ?? { revenue: 0, commission: 0, lines: 0 }
      bucket.revenue += line.revenuePLN
      bucket.commission += line.commissionPLN
      bucket.lines += 1
      totals.set(line.source, bucket)
    }
  }

  const build = (channel: Channel): ChannelRate => {
    const bucket = totals.get(channel)
    if (!bucket || bucket.revenue <= 0) {
      return { channel, rate: DEFAULT_COMMISSION_RATE, measured: false, sampleLines: 0 }
    }
    return {
      channel,
      rate: bucket.commission / bucket.revenue,
      measured: true,
      sampleLines: bucket.lines,
    }
  }

  return { shopify: build('shopify'), allegro: build('allegro'), empik: build('empik'), vonhalsky: build('vonhalsky') }
}

/* ── benchmarking ───────────────────────────────────────────────────────── */

export interface MarginBenchmark {
  portfolioMarginPct: number
  /** Share of current products this candidate would beat, 0–100. */
  percentile: number
  /** Products ranked below this margin. */
  beats: number
  comparedWith: number
  /** Median margin of the products actually sold — the typical listing. */
  medianMarginPct: number
}

/**
 * Where this margin would sit among products actually being sold.
 *
 * A percentage in isolation does not answer "is this good *for us*" — 12%
 * might be excellent in one catalogue and dismal in another. Ranking against
 * the real portfolio is what turns the number into a judgement. Returns null
 * rather than a misleading rank when there is not enough to compare against.
 */
export function buildMarginBenchmark(
  products: readonly ProductPerformance[],
  marginPct: number,
): MarginBenchmark | null {
  const comparable = products.filter(
    (product) => !product.costUnknown && Number.isFinite(product.marginPct),
  )
  if (comparable.length < 3) return null

  const margins = comparable.map((product) => product.marginPct).sort((a, b) => a - b)
  const beats = margins.filter((value) => value < marginPct).length
  const middle = Math.floor(margins.length / 2)
  const median =
    margins.length % 2 === 0
      ? ((margins[middle - 1] ?? 0) + (margins[middle] ?? 0)) / 2
      : (margins[middle] ?? 0)

  const totalRevenue = sum(comparable, (product) => product.revenuePLN)
  const totalProfit = sum(comparable, (product) => product.marginPLN)

  return {
    portfolioMarginPct: ratio(totalProfit, totalRevenue) * 100,
    percentile: (beats / margins.length) * 100,
    beats,
    comparedWith: margins.length,
    medianMarginPct: median,
  }
}

/* ── verdict ────────────────────────────────────────────────────────────── */

export type VerdictKind = 'buy' | 'negotiate' | 'reprice' | 'pass' | 'incomplete'

export interface Verdict {
  kind: VerdictKind
  headline: string
  reasons: string[]
}

/* ── evaluation ─────────────────────────────────────────────────────────── */

export interface CandidateResult {
  landedCostPLN: number
  parts: CostParts
  commissionRate: number
  commissionSource: 'measured' | 'override' | 'assumed'
  commissionPLN: number

  profitPerUnitPLN: number
  marginPct: number
  health: MarginHealth
  status: PriceStatus

  breakEvenPricePLN: number | null
  /** Charm-rounded price that clears TARGET_MARGIN. */
  suggestedPricePLN: number | null
  /** Most you can pay per unit and still clear TARGET_MARGIN at this price. */
  maxPayableCostPLN: number | null
  /** How far the quote exceeds that ceiling; null when it is already under. */
  costOverrunPLN: number | null

  targets: MarginTarget[]
  waterfall: WaterfallStep[] | null
  verdict: Verdict
  /** True when cost or price is missing, so figures are not yet meaningful. */
  isIncomplete: boolean
}

export interface EvaluationContext {
  rates: Record<Channel, ChannelRate>
}

/**
 * Everything the page shows about one candidate, computed in one pass.
 *
 * Returns an explicitly `incomplete` verdict when cost or price is missing
 * rather than rendering a confident 0% — the same discipline as
 * `buildRecommendation`'s `fix-costs` branch. A calculator that answers before
 * it has been asked a whole question teaches the founder to distrust it.
 */
export function evaluateCandidate(
  candidate: Candidate,
  context: EvaluationContext,
): CandidateResult {
  const parts = costParts(candidate.cost)
  const cost = parts.totalPLN
  const price = candidate.sellingPricePLN

  const channelRate = context.rates[candidate.channel]
  const commissionRate =
    candidate.commissionRatePct !== null
      ? candidate.commissionRatePct / 100
      : channelRate.rate
  const commissionSource =
    candidate.commissionRatePct !== null
      ? 'override'
      : channelRate.measured
        ? 'measured'
        : 'assumed'

  const isIncomplete = !(cost > 0) || !(price > 0)

  const profit = isIncomplete ? 0 : profitAt(price, commissionRate, cost)
  const margin = isIncomplete ? 0 : marginAt(price, commissionRate, cost) * 100

  const breakEven = cost > 0 ? priceForMargin(0, commissionRate, cost) : null
  const targetPrice = cost > 0 ? priceForMargin(TARGET_MARGIN, commissionRate, cost) : null
  const suggested = targetPrice !== null ? toCharmPrice(targetPrice) : null
  const maxPayable = price > 0 ? maxCostForMargin(price, commissionRate, TARGET_MARGIN) : null
  const overrun = maxPayable !== null && cost > maxPayable ? cost - maxPayable : null

  const targets: MarginTarget[] = CALCULATOR_TARGETS.map((target) => {
    const required = cost > 0 ? priceForMargin(target, commissionRate, cost) : null
    return {
      label: target === 0 ? 'Break even' : `${Math.round(target * 100)}% margin`,
      marginPct: target * 100,
      requiredPricePLN: required,
      achieved: required !== null && price >= required,
    }
  })

  const waterfall: WaterfallStep[] | null = isIncomplete
    ? null
    : [
        { label: 'Selling price', amountPLN: price, kind: 'start' },
        { label: 'VAT (23%)', amountPLN: -(price - price * NET), kind: 'deduction' },
        { label: 'Marketplace fees', amountPLN: -(price * commissionRate), kind: 'deduction' },
        { label: 'Product cost', amountPLN: -parts.goodsPLN, kind: 'deduction' },
        ...(parts.freightPLN > 0
          ? [{ label: 'Inbound freight', amountPLN: -parts.freightPLN, kind: 'deduction' as const }]
          : []),
        ...(parts.dutyPLN > 0
          ? [{ label: 'Duty & customs', amountPLN: -parts.dutyPLN, kind: 'deduction' as const }]
          : []),
        { label: 'Net profit', amountPLN: profit, kind: 'result' },
      ]

  return {
    landedCostPLN: cost,
    parts,
    commissionRate,
    commissionSource,
    commissionPLN: isIncomplete ? 0 : price * commissionRate,
    profitPerUnitPLN: profit,
    marginPct: margin,
    health: classifyMargin(margin),
    status: statusFor(margin),
    breakEvenPricePLN: breakEven,
    suggestedPricePLN: suggested,
    maxPayableCostPLN: maxPayable,
    costOverrunPLN: overrun,
    targets,
    waterfall,
    verdict: buildVerdict({
      isIncomplete,
      cost,
      price,
      margin,
      profit,
      commissionRate,
      breakEven,
      suggested,
      maxPayable,
      overrun,
    }),
    isIncomplete,
  }
}

function buildVerdict(input: {
  isIncomplete: boolean
  cost: number
  price: number
  margin: number
  profit: number
  commissionRate: number
  breakEven: number | null
  suggested: number | null
  maxPayable: number | null
  overrun: number | null
}): Verdict {
  const { isIncomplete, cost, price, margin, profit, breakEven, suggested, maxPayable, overrun } =
    input

  if (isIncomplete) {
    const missing: string[] = []
    if (!(cost > 0)) missing.push('a supplier cost')
    if (!(price > 0)) missing.push('an intended selling price')
    return {
      kind: 'incomplete',
      headline: 'Not enough to judge yet',
      reasons: [`Enter ${missing.join(' and ')} to see whether this product works.`],
    }
  }

  const fmt = (value: number) => `${value.toFixed(2)} zł`
  const target = Math.round(TARGET_MARGIN * 100)

  // Loss-making: the only question is whether any price rescues it.
  if (profit <= 0) {
    if (breakEven === null) {
      return {
        kind: 'pass',
        headline: 'Cannot be sold profitably',
        reasons: [
          'Commission and VAT alone exceed the whole selling price, so no price recovers this cost.',
          'This is a sourcing problem — the landed cost has to come down before the listing is viable.',
        ],
      }
    }
    return {
      kind: 'pass',
      headline: `Loses ${fmt(Math.abs(profit))} per unit`,
      reasons: [
        `At ${fmt(price)} this sells below cost — margin is ${margin.toFixed(1)}%.`,
        `You would need at least ${fmt(breakEven)} just to break even.`,
        maxPayable !== null
          ? `To clear ${target}% at this price, the landed cost must be under ${fmt(maxPayable)}.`
          : `No landed cost clears ${target}% at this price.`,
      ],
    }
  }

  if (margin >= TARGET_MARGIN * 100) {
    return {
      kind: 'buy',
      headline: `Worth stocking — ${margin.toFixed(1)}% margin`,
      reasons: [
        `Returns ${fmt(profit)} per unit after VAT, commission and landed cost.`,
        `That clears the ${target}% line with room for freight or exchange-rate drift.`,
        maxPayable !== null && overrun === null
          ? `You have ${fmt(maxPayable - cost)} of headroom per unit before it stops working.`
          : 'Re-check if the quote or the exchange rate moves.',
      ],
    }
  }

  // Profitable but under target: name the two levers, and lead with the
  // cheaper one — a supplier discount costs nothing in demand, a price rise
  // costs conversion the data cannot see.
  const reasons: string[] = [
    `${margin.toFixed(1)}% is below the ${target}% you want on a new listing, though it does make ${fmt(profit)} a unit.`,
  ]
  if (overrun !== null && maxPayable !== null) {
    reasons.push(
      `Negotiate the landed cost under ${fmt(maxPayable)} — that is ${fmt(overrun)} per unit off the current quote.`,
    )
  }
  if (suggested !== null) {
    reasons.push(`Or list at ${fmt(suggested)} instead of ${fmt(price)} to clear ${target}%.`)
  }

  return {
    kind: overrun !== null ? 'negotiate' : 'reprice',
    headline: `Thin at ${margin.toFixed(1)}% — worth pushing on`,
    reasons,
  }
}
