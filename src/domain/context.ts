/**
 * Assembles the single derived object the UI reads from.
 *
 * Built once per data load. Pages and components receive finished numbers and
 * never recompute anything — which is what keeps business logic out of React
 * and makes every figure on screen traceable to one function here.
 */

import type { RawProductCost, RawTransaction } from './api'
import { computeHealthScore } from './health'
import { generateInsights } from './insights'
import { mapProductCost, mapTransaction } from './mappers'
import {
  buildChannelPerformance,
  buildComparison,
  buildCoverage,
  buildDailySeries,
  buildProductPerformance,
} from './metrics'
import { ratio, sum } from './parse'
import type { BusinessContext, MonthlyPoint, Summary } from './types'

export interface BusinessContextInput {
  transactions: readonly RawTransaction[]
  productCosts: readonly RawProductCost[]
  summary: Summary | null
  monthly: readonly MonthlyPoint[]
}

/**
 * Recomputes headline KPIs locally when the server summary is unavailable, so a
 * single failed endpoint degrades one number rather than the whole page.
 */
function deriveSummary(context: Pick<BusinessContext, 'orders' | 'products'>): Summary {
  const revenue = sum(context.orders, (order) => order.revenuePLN)
  const margin = sum(context.orders, (order) => order.marginPLN)
  return {
    totalOrders: context.orders.length,
    totalRevenuePLN: revenue,
    totalMarginPLN: margin,
    avgMarginPct: ratio(margin, revenue) * 100,
    uniqueProducts: context.products.length,
    uniqueCustomers: new Set(
      context.orders.map((order) => order.customerName).filter(Boolean),
    ).size,
  }
}

export function buildBusinessContext(input: BusinessContextInput): BusinessContext {
  const orders = input.transactions.map(mapTransaction)
  const costs = input.productCosts.map(mapProductCost)

  const products = buildProductPerformance(orders, costs)
  const channels = buildChannelPerformance(orders)
  const daily = buildDailySeries(orders)
  const comparison = buildComparison(daily)
  const coverage = buildCoverage(orders, costs)

  // Insights are generated first so the health headline can acknowledge them.
  const insights = generateInsights({ orders, products, channels, comparison, coverage })
  const health = computeHealthScore({
    orders,
    products,
    channels,
    comparison,
    coverage,
    criticalFindings: insights.filter((insight) => insight.severity === 'critical').length,
    attentionFindings: insights.filter((insight) => insight.severity === 'attention').length,
  })

  return {
    orders,
    costs,
    summary: input.summary ?? deriveSummary({ orders, products }),
    daily,
    monthly: [...input.monthly],
    products,
    channels,
    comparison,
    coverage,
    health,
    insights,
  }
}
