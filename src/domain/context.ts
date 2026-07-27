/**
 * Assembles the dataset the whole application reads from.
 *
 * This runs once per data load and is period-agnostic: it holds every order
 * ever placed. Scoping to a Business Snapshot period happens afterwards in
 * `snapshot.ts`, so changing the period never refetches or re-parses anything.
 */

import type { RawProductCost, RawTransaction } from './api'
import { mapProductCost, mapTransaction } from './mappers'
import {
  buildChannelPerformance,
  buildComparison,
  buildCoverage,
  buildProductPerformance,
  buildSeries,
} from './metrics'
import { buildOrders } from './orders'
import { ratio, sum } from './parse'
import type {
  ChannelPerformance,
  DailyPoint,
  DataCoverage,
  LineItem,
  MonthlyPoint,
  Order,
  PeriodComparison,
  ProductCost,
  ProductPerformance,
  Summary,
} from './types'

/** Everything known about the business, unscoped. */
export interface BusinessContext {
  /** Individual product lines, as stored in the sheet. */
  lineItems: LineItem[]
  /** Customer purchases, assembled from those lines. */
  orders: Order[]
  costs: ProductCost[]
  summary: Summary
  /** Daily series across all history. */
  daily: DailyPoint[]
  monthly: MonthlyPoint[]
  products: ProductPerformance[]
  channels: ChannelPerformance[]
  comparison: PeriodComparison
  coverage: DataCoverage
}

export interface BusinessContextInput {
  transactions: readonly RawTransaction[]
  productCosts: readonly RawProductCost[]
  summary: Summary | null
  monthly: readonly MonthlyPoint[]
}

/**
 * Recomputes headline KPIs locally when the server summary is unavailable, so a
 * single failed endpoint degrades one number rather than the whole page.
 *
 * Note this deliberately diverges from the server's `totalOrders`, which counts
 * sheet rows. Luora counts customer orders.
 */
function deriveSummary(orders: readonly Order[], products: readonly ProductPerformance[]): Summary {
  const revenue = sum(orders, (order) => order.revenuePLN)
  const margin = sum(orders, (order) => order.marginPLN)
  return {
    totalOrders: orders.length,
    totalRevenuePLN: revenue,
    totalMarginPLN: margin,
    avgMarginPct: ratio(margin, revenue) * 100,
    uniqueProducts: products.length,
    uniqueCustomers: new Set(orders.map((order) => order.customerName).filter(Boolean)).size,
  }
}

export function buildBusinessContext(input: BusinessContextInput): BusinessContext {
  const lineItems = input.transactions.map(mapTransaction)
  const costs = input.productCosts.map(mapProductCost)
  const orders = buildOrders(lineItems)

  const products = buildProductPerformance(orders, costs)
  const channels = buildChannelPerformance(orders)
  const daily = buildSeries(orders, 'day')
  const comparison = buildComparison(daily)
  const coverage = buildCoverage(orders, costs)

  return {
    lineItems,
    orders,
    costs,
    // The server counts rows; we count orders, so the local derivation wins.
    summary: deriveSummary(orders, products),
    daily,
    monthly: [...input.monthly],
    products,
    channels,
    comparison,
    coverage,
  }
}
