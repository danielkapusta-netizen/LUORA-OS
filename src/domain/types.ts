/**
 * Canonical domain model for Luora OS.
 *
 * These types describe the business, not the spreadsheet. Raw API payloads are
 * translated into this shape exactly once (see `mappers.ts`) so that no
 * component ever has to know that `margin` can arrive as an empty string.
 *
 * The central distinction: a **LineItem** is one row in the sheet (one product
 * within a purchase); an **Order** is what the customer actually placed. A
 * three-product basket is one order, not three. Conflating them overstated
 * order counts by 6.9% and made average basket value meaningless.
 */

export type Currency = 'PLN' | 'EUR' | 'CZK' | 'HUF'
export type Channel = 'allegro' | 'empik'

/** One product line within an order — one row of the source sheet. */
export interface LineItem {
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
  /**
   * Implied FX rate for this line (pricePLN / price). The sheet stores only
   * converted price, so this is how shipping and commission reach PLN.
   */
  fxRate: number
  /** Gross revenue converted to PLN. */
  revenuePLN: number
  /** Marketplace commission in PLN. */
  commissionPLN: number
  /** Shipping charged on this line, in PLN. */
  shipmentPLN: number
  /** True profit in PLN, net of marketplace commission and product cost. */
  marginPLN: number
  /** Margin as a share of revenue, or null when revenue is unknown. */
  marginPct: number | null
  customerName: string
  source: Channel
  date: Date | null
  /** False when the source row had missing or unparseable financials. */
  isComplete: boolean
  /** Key identifying the order this line belongs to. */
  orderKey: string
}

/** A customer purchase: one or more line items bought together. */
export interface Order {
  id: string
  date: Date | null
  customerName: string
  source: Channel
  items: LineItem[]
  /** Number of distinct product lines. */
  lineCount: number
  /** Total units across all lines. */
  units: number
  revenuePLN: number
  marginPLN: number
  marginPct: number | null
  commissionPLN: number
  shipmentPLN: number
  /** False when any line failed to parse. */
  isComplete: boolean
  /**
   * True when this order originally arrived as two or more rows that were
   * exact duplicates of the same product (same SKU, price and currency),
   * with no other product present. This is a known source-sheet fault where
   * a second product's row is written as a copy of the first instead of the
   * actual item — the true second product is not recoverable from the feed.
   * The duplicate row is dropped so revenue is not double-counted, but the
   * order total still understates what was really sold.
   */
  hasSuspectedMissingLine: boolean
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

/** One bucket of trading activity at whatever grain is being viewed. */
export interface DailyPoint {
  /** ISO date, `YYYY-MM-DD` — the bucket's starting day. */
  date: string
  orders: number
  units: number
  revenuePLN: number
  marginPLN: number
  marginPct: number
  /** Revenue divided by orders — average basket for the bucket. */
  avgOrderValuePLN: number
}

/** The grain a time series is aggregated at. */
export type Granularity = 'day' | 'week' | 'month' | 'quarter' | 'year'

/** Everything known about a single product, joined across line items and costs. */
export interface ProductPerformance {
  productKey: string
  label: string
  /** Brand inferred from the listing title. */
  brand: string
  /** Coarse product category inferred from the listing title. */
  category: string
  /** Orders containing this product. */
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
  /** Average selling price per unit, in PLN. */
  avgUnitPricePLN: number
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
  totalLineItems: number
  /** Line items whose financials parsed cleanly. */
  completeLineItems: number
  /** Lines we could not match to a cost record — their margin is overstated. */
  linesMissingCost: number
  revenueMissingCostPLN: number
  /**
   * Orders where the source sheet wrote a duplicate of one product into the
   * row meant for a second, different product — the true second item is not
   * recoverable from this feed, so these orders understate what actually sold.
   */
  ordersWithMissingLine: number
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
  /** How much the evidence supports the finding. */
  confidence?: Confidence
  /** Concrete supporting facts, rendered as a list. */
  evidence?: string[]
}

export type Confidence = 'high' | 'medium' | 'low'

/**
 * A KPI carries its own context: what it was, where it peaked, what is typical,
 * and its shape over the period. A bare number cannot be judged.
 */
export interface Kpi {
  key: string
  label: string
  value: number
  /** Same measure over the preceding equal-length window. */
  previous: number | null
  /** Percentage change vs the previous window (percentage points for rates). */
  changePct: number | null
  /** True when this measure is a rate, so deltas are percentage points. */
  isRate?: boolean
  /** Highest bucket value within the period. */
  peak: { value: number; label: string } | null
  /** Mean bucket value within the period. */
  average: number
  /** Bucket values, for the sparkline. */
  series: number[]
  format: 'pln' | 'number' | 'percent'
  /** How the figure is derived — surfaced as a tooltip. */
  hint: string
  /** False when a rise in this measure is bad news. */
  higherIsBetter?: boolean
}
