/**
 * Pricing Intelligence — the domain behind the pricing control centre.
 *
 * Everything here rests on one verified identity. The sheet's profit per line
 * reproduces, to the grosz, as:
 *
 *     profit = price / (1 + VAT) − commission − unitCost × qty
 *
 * checked against ~3,700 live rows (94% exact; the remainder trace to
 * duplicate cost-sheet entries, not to the formula). That gives an honest
 * forward model for "what happens at price P":
 *
 *     profit(P) = P / 1.23 − commRate · P − unitCost
 *     margin(P) = profit(P) / P
 *
 * and, solved for P, the exact price required to hit a target margin:
 *
 *     P(m) = unitCost / (1/1.23 − commRate − m)
 *
 * VAT sits inside every listed price, so it must sit inside every projection —
 * a target price computed on gross revenue would systematically understate by
 * 23%. Commission rates are measured per product from its own recent lines
 * (portfolio averages: Allegro ≈ 15%, Empik ≈ 17.9% of gross).
 */

import { buildCostIndex } from './metrics'
import { bucketKey } from './period'
import { ratio, sum } from './parse'
import { resolveCostKey } from './sku'
import type { Granularity, LineItem, Order, ProductCost } from './types'

export const VAT_RATE = 0.23
/** Net share of a gross price after VAT. */
const NET = 1 / (1 + VAT_RATE)

export type PricingPeriodKey = 'last5' | 'week' | 'month' | 'lastMonth' | 'quarter' | 'year' | 'all'

export const PRICING_PERIODS: Array<{ value: PricingPeriodKey; label: string }> = [
  { value: 'last5', label: 'Last 5 sales' },
  { value: 'week', label: 'This week' },
  { value: 'month', label: 'This month' },
  { value: 'lastMonth', label: 'Last month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
]

export type MarginHealth = 'excellent' | 'healthy' | 'acceptable' | 'low' | 'critical' | 'loss'

export function classifyMargin(marginPct: number): MarginHealth {
  if (marginPct < 0) return 'loss'
  if (marginPct < 5) return 'critical'
  if (marginPct < 10) return 'low'
  if (marginPct < 15) return 'acceptable'
  if (marginPct < 25) return 'healthy'
  return 'excellent'
}

/** Traffic-light status for the table: green >15, yellow 10–15, red <10. */
export type PriceStatus = 'green' | 'yellow' | 'red'

export function statusFor(marginPct: number): PriceStatus {
  if (marginPct > 15) return 'green'
  if (marginPct >= 10) return 'yellow'
  return 'red'
}

export interface MarginTarget {
  label: string
  marginPct: number
  /** Gross price required, or null when unreachable at this cost/commission. */
  requiredPricePLN: number | null
  /** True when the current average price already clears this target. */
  achieved: boolean
}

export interface PricePoint {
  date: Date
  /** Gross unit price actually realised. */
  unitPricePLN: number
  unitProfitPLN: number
  marginPct: number | null
}

export interface PriceStability {
  currentPricePLN: number
  averagePricePLN: number
  minPricePLN: number
  maxPricePLN: number
  /** Distinct realised unit prices in the window. */
  distinctPrices: number
  /** (max − min) / average — 0 means one price held throughout. */
  volatilityPct: number
  /** Average shortfall of realised prices against the window's top price. */
  avgDiscountPct: number
}

export interface PricingRecommendation {
  kind: 'raise' | 'hold' | 'fix-costs'
  currentPricePLN: number
  recommendedPricePLN: number | null
  expectedMarginPct: number | null
  expectedMonthlyUpliftPLN: number | null
  confidencePct: number
  reasons: string[]
}

export interface RiskFlag {
  currentMarginPct: number
  previousMarginPct: number
  /** Consecutive months of decline. */
  streak: number
  estMonthlyImpactPLN: number
  note: string
}

/** Everything the pricing workspace knows about one product (or brand). */
export interface PricingRow {
  key: string
  label: string
  /** Product keys rolled into this row — 1 in product mode. */
  productKeys: string[]
  /** Lines inside the selected window, newest first. */
  recentLines: LineItem[]
  /** Full parsed history for this row, for trend and stability charts. */
  allLines: LineItem[]
  ordersInWindow: number
  unitsInWindow: number

  currentPricePLN: number
  averagePricePLN: number
  averageProfitPLN: number
  averageMarginPct: number
  avgCommissionPLN: number
  avgShippingPLN: number
  /** Landed cost per unit, null when not on file. */
  unitCostPLN: number | null
  /** Effective commission as a share of gross, measured from this row's lines. */
  commissionRate: number

  monthlyRevenuePLN: number
  monthlyProfitPLN: number
  monthlyUnits: number

  status: PriceStatus
  health: MarginHealth
  targets: MarginTarget[]
  stability: PriceStability
  recommendation: PricingRecommendation
  risk: RiskFlag | null
  costUnknown: boolean
}

export interface PricingSummary {
  productCount: number
  belowTenPct: number
  tenToFifteen: number
  aboveFifteen: number
  atRiskCount: number
  /** Sum of recommended monthly uplifts — the profit on the table. */
  onTheTablePLN: number
  avgMarginPct: number
}

export interface PricingWorkspace {
  rows: PricingRow[]
  summary: PricingSummary
}

const TARGET_MARGINS = [0, 0.05, 0.1, 0.15, 0.2, 0.25]
const DAY_MS = 86_400_000

/* ── forward model ──────────────────────────────────────────────────────── */

/** Profit per unit at gross price P. */
export function profitAt(priceGross: number, commissionRate: number, unitCost: number): number {
  return priceGross * NET - priceGross * commissionRate - unitCost
}

/** Margin (share of gross) at price P. */
export function marginAt(priceGross: number, commissionRate: number, unitCost: number): number {
  return priceGross > 0 ? profitAt(priceGross, commissionRate, unitCost) / priceGross : 0
}

/** Gross price required to reach a target margin, or null when unreachable. */
export function priceForMargin(
  targetMargin: number,
  commissionRate: number,
  unitCost: number,
): number | null {
  const denominator = NET - commissionRate - targetMargin
  if (denominator <= 0.001) return null
  return unitCost / denominator
}

/** Prices ending in .90 convert better on Polish marketplaces; round up to one. */
function toCharmPrice(price: number): number {
  const floor = Math.floor(price)
  const charm = floor + 0.9
  return charm >= price ? charm : floor + 1 + 0.9
}

/* ── window selection ───────────────────────────────────────────────────── */

function windowStart(key: PricingPeriodKey, anchor: Date): Date | null {
  const day = Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate())
  switch (key) {
    case 'week': {
      const offset = (new Date(day).getUTCDay() + 6) % 7
      return new Date(day - offset * DAY_MS)
    }
    case 'month':
      return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1))
    case 'lastMonth':
      return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 1, 1))
    case 'quarter':
      return new Date(
        Date.UTC(anchor.getUTCFullYear(), Math.floor(anchor.getUTCMonth() / 3) * 3, 1),
      )
    case 'year':
      return new Date(Date.UTC(anchor.getUTCFullYear(), 0, 1))
    default:
      return null
  }
}

/** Lines feeding a row's statistics for the chosen period, newest first. */
function selectWindow(lines: readonly LineItem[], key: PricingPeriodKey, anchor: Date): LineItem[] {
  const sorted = [...lines].sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
  if (key === 'last5') return sorted.slice(0, 5)
  if (key === 'all') return sorted
  const from = windowStart(key, anchor)
  if (!from) return sorted
  const to =
    key === 'lastMonth'
      ? new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1) - 1)
      : anchor
  return sorted.filter((line) => line.date && line.date >= from && line.date <= to)
}

/* ── row assembly ───────────────────────────────────────────────────────── */

function buildStability(lines: readonly LineItem[]): PriceStability {
  const unitPrices = lines
    .filter((line) => line.qty > 0 && line.revenuePLN > 0)
    .map((line) => line.revenuePLN / line.qty)

  if (unitPrices.length === 0) {
    return {
      currentPricePLN: 0,
      averagePricePLN: 0,
      minPricePLN: 0,
      maxPricePLN: 0,
      distinctPrices: 0,
      volatilityPct: 0,
      avgDiscountPct: 0,
    }
  }

  const average = sum(unitPrices, (price) => price) / unitPrices.length
  const min = Math.min(...unitPrices)
  const max = Math.max(...unitPrices)
  // Prices within a few grosz are the same listing price, not a change.
  const distinct = new Set(unitPrices.map((price) => Math.round(price * 10))).size

  return {
    currentPricePLN: unitPrices[0] ?? 0,
    averagePricePLN: average,
    minPricePLN: min,
    maxPricePLN: max,
    distinctPrices: distinct,
    volatilityPct: average > 0 ? ((max - min) / average) * 100 : 0,
    avgDiscountPct: max > 0 ? ((max - average) / max) * 100 : 0,
  }
}

/** Realised unit price and margin per sale, oldest first, for the charts. */
export function buildPriceHistory(lines: readonly LineItem[]): PricePoint[] {
  return lines
    .filter((line) => line.date && line.qty > 0 && line.revenuePLN > 0)
    .sort((a, b) => a.date!.getTime() - b.date!.getTime())
    .map((line) => ({
      date: line.date!,
      unitPricePLN: line.revenuePLN / line.qty,
      unitProfitPLN: line.marginPLN / line.qty,
      marginPct: line.marginPct,
    }))
}

export interface MarginHistoryPoint {
  date: string
  marginPct: number
  revenuePLN: number
  profitPLN: number
}

/** Margin over time at the requested grain, for the trend chart. */
export function buildMarginHistory(
  lines: readonly LineItem[],
  granularity: Granularity,
): MarginHistoryPoint[] {
  const buckets = new Map<string, { revenue: number; profit: number }>()
  for (const line of lines) {
    if (!line.date || !line.isComplete) continue
    const key = bucketKey(line.date, granularity)
    const bucket = buckets.get(key) ?? { revenue: 0, profit: 0 }
    bucket.revenue += line.revenuePLN
    bucket.profit += line.marginPLN
    buckets.set(key, bucket)
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, bucket]) => ({
      date,
      marginPct: ratio(bucket.profit, bucket.revenue) * 100,
      revenuePLN: bucket.revenue,
      profitPLN: bucket.profit,
    }))
}

function buildRisk(allLines: readonly LineItem[]): RiskFlag | null {
  const monthly = buildMarginHistory(allLines, 'month')
  if (monthly.length < 3) return null

  // Decline must be consecutive and current — a dip two months ago that has
  // since recovered is history, not risk.
  let streak = 0
  for (let index = monthly.length - 1; index > 0; index -= 1) {
    if (monthly[index]!.marginPct < monthly[index - 1]!.marginPct - 0.5) streak += 1
    else break
  }
  if (streak < 2) return null

  const current = monthly[monthly.length - 1]!
  const before = monthly[monthly.length - 1 - streak]!
  const impact = (current.revenuePLN * (before.marginPct - current.marginPct)) / 100

  return {
    currentMarginPct: current.marginPct,
    previousMarginPct: before.marginPct,
    streak,
    estMonthlyImpactPLN: impact,
    note: `Margin has fallen ${streak} months running, from ${before.marginPct.toFixed(1)}% to ${current.marginPct.toFixed(1)}%.`,
  }
}

function buildRecommendation(row: {
  averagePricePLN: number
  averageMarginPct: number
  unitCostPLN: number | null
  commissionRate: number
  monthlyUnits: number
  ordersInWindow: number
  stability: PriceStability
  risk: RiskFlag | null
}): PricingRecommendation {
  const {
    averagePricePLN,
    averageMarginPct,
    unitCostPLN,
    commissionRate,
    monthlyUnits,
    ordersInWindow,
    stability,
    risk,
  } = row

  if (unitCostPLN === null) {
    return {
      kind: 'fix-costs',
      currentPricePLN: averagePricePLN,
      recommendedPricePLN: null,
      expectedMarginPct: null,
      expectedMonthlyUpliftPLN: null,
      confidencePct: 0,
      reasons: [
        'No landed cost on file, so no target price can be computed honestly.',
        'Add this product to the cost sheet first — every figure here is unverified until then.',
      ],
    }
  }

  // Confidence: how much evidence, and how stable the price the evidence sits on.
  const evidence = Math.min(1, ordersInWindow / 12)
  const steadiness = Math.max(0, 1 - stability.volatilityPct / 40)
  const confidencePct = Math.round(40 + evidence * 35 + steadiness * 25)

  if (averageMarginPct >= 15) {
    const reasons = [
      `Margin of ${averageMarginPct.toFixed(1)}% is already in healthy territory.`,
      stability.distinctPrices <= 2
        ? 'Price has held steady — no evidence the market is resisting it.'
        : 'Price has moved recently; let it settle before the next change.',
    ]
    if (risk) reasons.push('Watch the declining monthly trend before considering any reduction.')
    return {
      kind: 'hold',
      currentPricePLN: averagePricePLN,
      recommendedPricePLN: null,
      expectedMarginPct: averageMarginPct,
      expectedMonthlyUpliftPLN: null,
      confidencePct,
      reasons,
    }
  }

  // Below healthy: recommend the charm price that clears 18% margin — far
  // enough above the 15% line that ordinary cost drift will not immediately
  // put the product back on this list.
  const rawTarget = priceForMargin(0.18, commissionRate, unitCostPLN)
  if (rawTarget === null) {
    return {
      kind: 'fix-costs',
      currentPricePLN: averagePricePLN,
      recommendedPricePLN: null,
      expectedMarginPct: null,
      expectedMonthlyUpliftPLN: null,
      confidencePct,
      reasons: [
        'No realistic price reaches a healthy margin at this landed cost and commission.',
        'This is a cost or sourcing problem, not a pricing problem — renegotiate or retire the listing.',
      ],
    }
  }

  const recommended = toCharmPrice(Math.max(rawTarget, averagePricePLN))
  const expectedMargin = marginAt(recommended, commissionRate, unitCostPLN) * 100
  const upliftPerUnit =
    profitAt(recommended, commissionRate, unitCostPLN) -
    profitAt(averagePricePLN, commissionRate, unitCostPLN)
  const monthlyUplift = upliftPerUnit * monthlyUnits

  const priceRisePct =
    averagePricePLN > 0 ? ((recommended - averagePricePLN) / averagePricePLN) * 100 : 0

  return {
    kind: 'raise',
    currentPricePLN: averagePricePLN,
    recommendedPricePLN: recommended,
    expectedMarginPct: expectedMargin,
    expectedMonthlyUpliftPLN: monthlyUplift,
    // Large price jumps carry demand risk the data cannot see; discount for it.
    confidencePct: Math.max(30, Math.round(confidencePct - Math.max(0, priceRisePct - 8))),
    reasons: [
      `Current ${averageMarginPct.toFixed(1)}% margin is below the 15% healthy line.`,
      `At ${recommended.toFixed(2)} zł the margin clears ${expectedMargin.toFixed(1)}% after VAT and ${(row.commissionRate * 100).toFixed(1)}% commission.`,
      monthlyUnits > 0
        ? `Assumes current volume holds (${monthlyUnits} units/month) — a ${priceRisePct.toFixed(0)}% rise, small enough that demand usually does.`
        : 'No sales in the last 30 days — the uplift estimate is indicative only.',
    ],
  }
}

/* ── workspace assembly ─────────────────────────────────────────────────── */

export interface PricingInput {
  orders: readonly Order[]
  costs: readonly ProductCost[]
  dimension: 'product' | 'brand'
  period: PricingPeriodKey
  /** Newest order date — the clock the windows anchor to. */
  anchor: Date
  /** Brand resolver, injected to keep this module free of taxonomy imports. */
  brandOf: (label: string) => string
}

export function buildPricingWorkspace(input: PricingInput): PricingWorkspace {
  const { orders, costs, dimension, period, anchor, brandOf } = input
  const costIndex = buildCostIndex(costs)

  // Group every line by product (or brand), keeping the full history per key —
  // stability and risk need more than the display window.
  const groups = new Map<string, { label: string; lines: LineItem[]; productKeys: Set<string> }>()
  for (const order of orders) {
    for (const line of order.items) {
      const key = dimension === 'brand' ? brandOf(line.productLabel) : line.productKey
      const group = groups.get(key)
      if (group) {
        group.lines.push(line)
        group.productKeys.add(line.productKey)
      } else {
        groups.set(key, {
          label: dimension === 'brand' ? brandOf(line.productLabel) : line.productLabel,
          lines: [line],
          productKeys: new Set([line.productKey]),
        })
      }
    }
  }

  const monthAgo = new Date(anchor.getTime() - 30 * DAY_MS)
  const rows: PricingRow[] = []

  for (const [key, group] of groups) {
    const recentLines = selectWindow(group.lines, period, anchor).filter((line) => line.isComplete)
    if (recentLines.length === 0) continue

    const units = sum(recentLines, (line) => line.qty)
    const revenue = sum(recentLines, (line) => line.revenuePLN)
    const profit = sum(recentLines, (line) => line.marginPLN)
    const commission = sum(recentLines, (line) => line.commissionPLN)
    const shipping = sum(recentLines, (line) => line.shipmentPLN)

    // Landed cost, derived two ways with a strict preference order.
    //
    // Preferred: implied algebraically from the sheet's own lines —
    //     unitCost = (revenue · NET − commission − profit) / units
    // which is the margin identity solved for cost. This is exact by
    // construction and, critically, immune to the duplicate cost-sheet rows
    // that carry two different costs for the same product: whichever entry the
    // sheet's formula actually used is the one recovered here. Without this,
    // the margin shown from sheet data and the margin implied by the waterfall
    // and simulator visibly disagree on the same screen.
    //
    // Fallback: the cost sheet directly, when the window has no usable lines.
    let unitCost: number | null = null
    let costUnknown = false
    const impliedCost = units > 0 ? (revenue * NET - commission - profit) / units : null
    if (impliedCost !== null && Number.isFinite(impliedCost) && impliedCost > 0) {
      unitCost = impliedCost
    } else if (dimension === 'product') {
      const costKey = resolveCostKey(recentLines[0]!.rawSku, costIndex)
      unitCost = costKey ? (costIndex.get(costKey)?.totalCostPLN ?? null) : null
    }
    // "Cost unknown" still reflects the cost sheet: an implied cost keeps the
    // arithmetic honest, but a product missing from the cost sheet deserves
    // its warning either way.
    if (dimension === 'product') {
      costUnknown = resolveCostKey(recentLines[0]!.rawSku, costIndex) === null
    } else {
      costUnknown = recentLines.some((line) => resolveCostKey(line.rawSku, costIndex) === null)
    }
    if (unitCost === null) costUnknown = true

    const monthLines = group.lines.filter(
      (line) => line.isComplete && line.date && line.date >= monthAgo,
    )
    const monthlyUnits = sum(monthLines, (line) => line.qty)

    const stability = buildStability(
      selectWindow(group.lines, period === 'last5' ? 'last5' : period, anchor).filter(
        (line) => line.isComplete,
      ),
    )
    const averagePrice = units > 0 ? revenue / units : 0
    const averageMarginPct = ratio(profit, revenue) * 100
    const commissionRate = revenue > 0 ? commission / revenue : 0.15
    const risk = buildRisk(group.lines)

    const targets: MarginTarget[] = TARGET_MARGINS.map((target) => {
      const required =
        unitCost !== null ? priceForMargin(target, commissionRate, unitCost) : null
      return {
        label: target === 0 ? 'Break even' : `${Math.round(target * 100)}% margin`,
        marginPct: target * 100,
        requiredPricePLN: required,
        achieved: required !== null && averagePrice >= required,
      }
    })

    const recommendation = buildRecommendation({
      averagePricePLN: averagePrice,
      averageMarginPct,
      unitCostPLN: unitCost,
      commissionRate,
      monthlyUnits,
      ordersInWindow: recentLines.length,
      stability,
      risk,
    })

    rows.push({
      key,
      label: group.label,
      productKeys: [...group.productKeys],
      recentLines,
      allLines: group.lines.filter((line) => line.isComplete),
      ordersInWindow: recentLines.length,
      unitsInWindow: units,
      currentPricePLN: stability.currentPricePLN,
      averagePricePLN: averagePrice,
      averageProfitPLN: recentLines.length > 0 ? profit / recentLines.length : 0,
      averageMarginPct,
      avgCommissionPLN: recentLines.length > 0 ? commission / recentLines.length : 0,
      avgShippingPLN: recentLines.length > 0 ? shipping / recentLines.length : 0,
      unitCostPLN: unitCost,
      commissionRate,
      monthlyRevenuePLN: sum(monthLines, (line) => line.revenuePLN),
      monthlyProfitPLN: sum(monthLines, (line) => line.marginPLN),
      monthlyUnits,
      status: statusFor(averageMarginPct),
      health: classifyMargin(averageMarginPct),
      targets,
      stability,
      recommendation,
      risk,
      costUnknown,
    })
  }

  rows.sort((a, b) => b.monthlyRevenuePLN - a.monthlyRevenuePLN)

  const totalRevenue = sum(rows, (row) => row.monthlyRevenuePLN)
  const totalProfit = sum(rows, (row) => row.monthlyProfitPLN)

  const summary: PricingSummary = {
    productCount: rows.length,
    belowTenPct: rows.filter((row) => row.status === 'red').length,
    tenToFifteen: rows.filter((row) => row.status === 'yellow').length,
    aboveFifteen: rows.filter((row) => row.status === 'green').length,
    atRiskCount: rows.filter((row) => row.risk !== null).length,
    onTheTablePLN: sum(rows, (row) =>
      Math.max(0, row.recommendation.expectedMonthlyUpliftPLN ?? 0),
    ),
    avgMarginPct: ratio(totalProfit, totalRevenue) * 100,
  }

  return { rows, summary }
}

/* ── simulator ──────────────────────────────────────────────────────────── */

export interface SimulationResult {
  marginPct: number
  profitPerUnitPLN: number
  monthlyProfitPLN: number
  profitDeltaPerUnitPLN: number
  marginDeltaPp: number
  monthlyDeltaPLN: number
}

/** Pure function behind the interactive simulator — instant, no state. */
export function simulatePrice(row: PricingRow, priceGross: number): SimulationResult | null {
  if (row.unitCostPLN === null || priceGross <= 0) return null
  const profitPerUnit = profitAt(priceGross, row.commissionRate, row.unitCostPLN)
  const margin = marginAt(priceGross, row.commissionRate, row.unitCostPLN) * 100
  const currentProfitPerUnit = profitAt(
    row.averagePricePLN,
    row.commissionRate,
    row.unitCostPLN,
  )
  return {
    marginPct: margin,
    profitPerUnitPLN: profitPerUnit,
    monthlyProfitPLN: profitPerUnit * row.monthlyUnits,
    profitDeltaPerUnitPLN: profitPerUnit - currentProfitPerUnit,
    marginDeltaPp: margin - row.averageMarginPct,
    monthlyDeltaPLN: (profitPerUnit - currentProfitPerUnit) * row.monthlyUnits,
  }
}

/** Steps of the waterfall from gross price to net profit, per unit. */
export interface WaterfallStep {
  label: string
  amountPLN: number
  kind: 'start' | 'deduction' | 'result'
}

export function buildWaterfall(row: PricingRow): WaterfallStep[] | null {
  if (row.unitCostPLN === null || row.averagePricePLN <= 0) return null
  const price = row.averagePricePLN
  const vat = price - price * NET
  const commission = price * row.commissionRate
  const profit = profitAt(price, row.commissionRate, row.unitCostPLN)
  return [
    { label: 'Selling price', amountPLN: price, kind: 'start' },
    { label: 'VAT (23%)', amountPLN: -vat, kind: 'deduction' },
    { label: 'Marketplace commission', amountPLN: -commission, kind: 'deduction' },
    { label: 'Product cost', amountPLN: -row.unitCostPLN, kind: 'deduction' },
    { label: 'Net profit', amountPLN: profit, kind: 'result' },
  ]
}
