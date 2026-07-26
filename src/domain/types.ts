/**
 * Canonical domain model for Luora OS.
 *
 * These types describe the business, not the spreadsheet. Raw API payloads are
 * translated into this shape exactly once (see `parse.ts`) so that no component
 * ever has to know that `margin` can arrive as an empty string.
 */

export type Currency = 'PLN' | 'EUR' | 'CZK' | 'HUF'
export type Channel = 'allegro' | 'empik'

/** A single sale, normalised and denominated in PLN for aggregation. */
export interface Order {
  /** Stable synthetic id — the source has no primary key. */
  id: string
  /** Raw SKU string exactly as stored in the sheet. */
  rawSku: string
  /** Normalised join key, safe to group by. */
  productKey: string
  /** Human-readable product name with marketplace offer ids stripped. */
  productLabel: string
  qty: number
  currency: Currency
  /** Gross price in the original transaction currency. */
  priceOriginal: number
  netPriceOriginal: number
  commissionOriginal: number
  shipmentOriginal: number
  /** Gross revenue converted to PLN. */
  revenuePLN: number
  /** True profit in PLN, net of marketplace commission and product cost. */
  marginPLN: number
  /** Margin as a share of revenue, or null when revenue is unknown. */
  marginPct: number | null
  customerName: string
  source: Channel
  date: Date | null
  /** False when the source row had missing or unparseable financials. */
  isComplete: boolean
}

/** Landed cost of one product, as maintained in the cost sheet. */
export interface ProductCost {
  rawSku: string
  productKey: string
  productLabel: string
  totalCostPLN: number | null
  costEUR: number | null
  costUSD: number | null
  costPLN: number | null
  shipmentUSD: number | null
  higherMoq: number | null
}

/** Server-computed headline KPIs. */
export interface Summary {
  totalOrders: number
  totalRevenuePLN: number
  totalMarginPLN: number
  avgMarginPct: number
  uniqueProducts: number
  uniqueCustomers: number
}

export interface MonthlyPoint {
  month: string
  orders: number
  revenuePLN: number
  marginPLN: number
}

export interface SourcePoint {
  source: Channel
  orders: number
  revenuePLN: number
  marginPLN: number
}

export interface TopProduct {
  sku: string
  orders: number
  qty: number
  revenuePLN: number
  marginPLN: number
}

/** One day of trading activity. */
export interface DailyPoint {
  /** ISO date, `YYYY-MM-DD`. */
  date: string
  orders: number
  units: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
}

/** Everything known about a single product, joined across orders and costs. */
export interface ProductPerformance {
  productKey: string
  label: string
  orders: number
  units: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
  /** Share of total company revenue, 0–1. */
  revenueShare: number
  /** Share of total company profit, 0–1. */
  marginShare: number
  avgOrderValuePLN: number
  unitCostPLN: number | null
  /** True when this product could not be matched to a cost record. */
  costUnknown: boolean
  channels: Channel[]
  firstSold: Date | null
  lastSold: Date | null
}

export interface ChannelPerformance {
  source: Channel
  orders: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
  revenueShare: number
  avgOrderValuePLN: number
}

/** A like-for-like comparison of two adjacent trading windows. */
export interface PeriodComparison {
  /** Number of days in each window. */
  windowDays: number
  current: PeriodTotals
  previous: PeriodTotals
  revenueChangePct: number | null
  marginChangePct: number | null
  ordersChangePct: number | null
  /** False when history is too short for an honest comparison. */
  isReliable: boolean
}

export interface PeriodTotals {
  from: string
  to: string
  orders: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
}

/** How much of the business we can actually vouch for. */
export interface DataCoverage {
  totalOrders: number
  /** Orders whose financials parsed cleanly. */
  completeOrders: number
  /** Orders we could not match to a cost record — their margin is overstated. */
  ordersMissingCost: number
  revenueMissingCostPLN: number
  /** Share of revenue backed by a known landed cost, 0–1. */
  costCoverage: number
  firstOrder: Date | null
  /** The real edge of the data — never assume "today". */
  lastOrder: Date | null
  tradingDays: number
}

export type HealthBand = 'strong' | 'healthy' | 'watch' | 'at-risk'

/** One explainable contributor to the overall health score. */
export interface HealthComponent {
  key: string
  label: string
  /** 0–100. */
  score: number
  /** Relative influence on the composite, 0–1. */
  weight: number
  /** Plain-language reading of the underlying number. */
  detail: string
  /** The raw figure this score was derived from, pre-formatted. */
  value: string
}

export interface HealthScore {
  score: number
  band: HealthBand
  headline: string
  components: HealthComponent[]
}

export type InsightKind = 'risk' | 'opportunity'
export type InsightSeverity = 'critical' | 'attention' | 'info'

/**
 * A single machine-generated finding. Every insight must answer *why* it fired
 * and *what to do* — an observation without an action is noise.
 */
export interface Insight {
  id: string
  kind: InsightKind
  severity: InsightSeverity
  title: string
  /** The evidence. Always quantified. */
  why: string
  /** The recommended next step. */
  action: string
  /** Money at stake per trading period, when it can be estimated. */
  impactPLN: number | null
  /** Short label describing what `impactPLN` represents. */
  impactLabel: string | null
  /** The product or channel this concerns, for drill-through. */
  entity?: { type: 'product' | 'channel'; key: string; label: string }
}

/**
 * The single derived object the entire UI reads from. Built once per data load
 * so that pages stay presentational and calculations stay testable.
 */
export interface BusinessContext {
  orders: Order[]
  costs: ProductCost[]
  summary: Summary
  daily: DailyPoint[]
  monthly: MonthlyPoint[]
  products: ProductPerformance[]
  channels: ChannelPerformance[]
  comparison: PeriodComparison
  coverage: DataCoverage
  health: HealthScore
  insights: Insight[]
}
