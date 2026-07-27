import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ChevronDown, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { MarginTrendChart } from '@/components/charts/margin-trend-chart'
import { InsightCard } from '@/components/insight-card'
import { PageHeader } from '@/components/page-header'
import { PeriodSelector } from '@/components/period-selector'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import {
  buildCatalogue,
  buildCatalogueHistory,
  scoreCatalogueRow,
  type CatalogueDimension,
  type CatalogueRow,
  type HealthGrade,
} from '@/domain/catalogue'
import type { Snapshot } from '@/domain/snapshot'
import type { Insight, Order } from '@/domain/types'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatDate, formatNumber, formatPercent, formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

type SortKey = 'revenue' | 'margin' | 'marginPct' | 'orders'

const DIMENSION_OPTIONS = [
  { value: 'product' as const, label: 'Products' },
  { value: 'brand' as const, label: 'Brands' },
  { value: 'category' as const, label: 'Categories' },
]

const SORT_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
  { value: 'marginPct' as const, label: 'Margin %' },
  { value: 'orders' as const, label: 'Orders' },
]

const GRADE_STYLE: Record<HealthGrade, { label: string; variant: 'positive' | 'accent' | 'caution' | 'negative' }> = {
  excellent: { label: 'Excellent', variant: 'positive' },
  good: { label: 'Good', variant: 'accent' },
  watch: { label: 'Watch', variant: 'caution' },
  poor: { label: 'Poor', variant: 'negative' },
}

function sortRows(rows: readonly CatalogueRow[], key: SortKey): CatalogueRow[] {
  const pick: Record<SortKey, (row: CatalogueRow) => number> = {
    revenue: (row) => row.revenuePLN,
    margin: (row) => row.marginPLN,
    marginPct: (row) => row.marginPct,
    orders: (row) => row.orders,
  }
  return [...rows].sort((a, b) => pick[key](b) - pick[key](a))
}

/**
 * The catalogue at three altitudes. Products, brands and categories share one
 * table and one expanded panel — the toggle changes what a row *is*, not how
 * the page works, so the reading habit transfers between them.
 */
export function ProductsPage() {
  const {
    context,
    snapshot,
    period,
    periodKey,
    setPeriodKey,
    setCustomRange,
    isLoading,
    isError,
    error,
    refetch,
  } = useSnapshot()

  const [dimension, setDimension] = useState<CatalogueDimension>('product')
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [search, setSearch] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const rows = useMemo(() => {
    if (!snapshot) return []
    return buildCatalogue(snapshot.orders, dimension, snapshot.products)
  }, [snapshot, dimension])

  const visible = useMemo(() => {
    const query = search.trim().toLowerCase()
    const filtered = query ? rows.filter((row) => row.label.toLowerCase().includes(query)) : rows
    return sortRows(filtered, sortKey)
  }, [rows, search, sortKey])

  if (isLoading) return <PageSkeleton />
  if (isError || !context || !snapshot || !period) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Products" title="Products" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const noun = dimension === 'product' ? 'products' : dimension === 'brand' ? 'brands' : 'categories'

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Products"
        title="The catalogue, scored"
        description={`${formatNumber(rows.length)} ${noun} traded in ${period.label.toLowerCase()}, across ${formatNumber(snapshot.totals.orders)} orders. Open any row for its full intelligence panel.`}
        actions={
          <PeriodSelector
            value={periodKey}
            label={period.label}
            onChange={(key) => {
              setCustomRange(null)
              setPeriodKey(key)
              setOpenKey(null)
            }}
            onCustom={(from, to) => {
              setCustomRange({ from, to })
              setPeriodKey('custom')
              setOpenKey(null)
            }}
          />
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={DIMENSION_OPTIONS}
            value={dimension}
            onChange={(value) => {
              setDimension(value)
              setOpenKey(null)
            }}
            aria-label="Catalogue dimension"
          />
          <Segmented
            options={SORT_OPTIONS}
            value={sortKey}
            onChange={setSortKey}
            aria-label="Sort by"
          />
        </div>
        <label className="relative block max-w-xs flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={`Search ${noun}…`}
            className="h-9 w-full rounded-control border border-hairline bg-surface pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-subtle"
          />
        </label>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title={`No ${noun} in this period`}
            description="Widen the snapshot period or clear the search."
          />
        </Card>
      ) : (
        <div className="space-y-3">
          {visible.map((row, index) => (
            <CatalogueRowCard
              key={row.key}
              row={row}
              rank={index + 1}
              dimension={dimension}
              snapshot={snapshot}
              allOrders={context.orders}
              isOpen={openKey === row.key}
              onToggle={() => setOpenKey(openKey === row.key ? null : row.key)}
              onDrillToProducts={() => {
                setDimension('product')
                setSearch('')
                setOpenKey(null)
              }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function CatalogueRowCard({
  row,
  rank,
  dimension,
  snapshot,
  allOrders,
  isOpen,
  onToggle,
  onDrillToProducts,
}: {
  row: CatalogueRow
  rank: number
  dimension: CatalogueDimension
  snapshot: Snapshot
  allOrders: readonly Order[]
  isOpen: boolean
  onToggle: () => void
  onDrillToProducts: () => void
}) {
  const isThin = row.marginPct < 15

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: Math.min(rank, 12) * 0.03, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className={cn('overflow-hidden transition-shadow', isOpen && 'shadow-lifted')}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={isOpen}
          className="flex w-full items-center gap-4 px-5 py-4 text-left"
        >
          <span className="tnum w-6 shrink-0 text-[12px] font-medium text-ink-subtle">{rank}</span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate text-[14px] font-medium text-ink" title={row.label}>
                {row.label}
              </span>
              {row.costUnknown && (
                <Tooltip
                  content={
                    dimension === 'product'
                      ? 'No landed cost on file — reported profit excludes COGS and is overstated.'
                      : 'At least one product here has no landed cost on file, so this profit is overstated.'
                  }
                >
                  <AlertCircle
                    className="h-3.5 w-3.5 shrink-0 text-caution"
                    aria-label="Cost missing"
                  />
                </Tooltip>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-ink-subtle">
              {formatNumber(row.orders)} {row.orders === 1 ? 'order' : 'orders'} ·{' '}
              {formatNumber(row.units)} units
              {dimension !== 'product' && ` · ${row.memberCount} products`}
            </p>
          </div>

          <div className="hidden shrink-0 items-baseline gap-6 sm:flex">
            <Figure label="Revenue" value={formatPLN(row.revenuePLN)} />
            <Figure label="Profit" value={formatPLN(row.marginPLN)} />
            <Figure
              label="Margin"
              value={formatPercent(row.marginPct)}
              tone={isThin ? 'negative' : undefined}
            />
          </div>

          <ChevronDown
            className={cn(
              'h-4 w-4 shrink-0 text-ink-subtle transition-transform duration-200',
              isOpen && 'rotate-180',
            )}
            aria-hidden="true"
          />
        </button>

        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <RowDetail
                row={row}
                dimension={dimension}
                snapshot={snapshot}
                allOrders={allOrders}
                onDrillToProducts={onDrillToProducts}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}

function Figure({ label, value, tone }: { label: string; value: string; tone?: 'negative' }) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
        {label}
      </p>
      <p
        className={cn(
          'tnum text-[14px] font-semibold',
          tone === 'negative' ? 'text-negative' : 'text-ink',
        )}
      >
        {value}
      </p>
    </div>
  )
}

function RowDetail({
  row,
  dimension,
  snapshot,
  allOrders,
  onDrillToProducts,
}: {
  row: CatalogueRow
  dimension: CatalogueDimension
  snapshot: Snapshot
  allOrders: readonly Order[]
  onDrillToProducts: () => void
}) {
  // History runs over all orders, not the snapshot period — a trend confined to
  // the selected window would restate the same number it sits beneath.
  const history = useMemo(
    () => buildCatalogueHistory(allOrders, row.productKeys),
    [allOrders, row.productKeys],
  )
  const health = useMemo(
    () => scoreCatalogueRow(row, snapshot.totals.marginPct, history),
    [row, snapshot.totals.marginPct, history],
  )

  const ownInsights: Insight[] = snapshot.insights.filter((insight) =>
    insight.entity ? row.productKeys.includes(insight.entity.key) : false,
  )

  const grade = GRADE_STYLE[health.grade]
  const profitPerOrder = row.orders > 0 ? row.marginPLN / row.orders : 0

  const stats = [
    { label: 'Avg order value', value: formatPLN(row.avgOrderValuePLN) },
    { label: 'Avg unit price', value: formatPLN(row.avgUnitPricePLN) },
    { label: 'Profit per order', value: formatPLN(profitPerOrder) },
    { label: 'Revenue share', value: formatPercent(row.revenueShare * 100) },
    { label: 'Profit share', value: formatPercent(row.marginShare * 100) },
    { label: 'First sale in period', value: formatDate(row.firstSold) },
    { label: 'Latest sale', value: formatDate(row.lastSold) },
    { label: 'Units', value: formatNumber(row.units) },
  ]

  return (
    <div className="space-y-6 border-t border-hairline bg-surface-sunken/40 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full border border-hairline bg-surface">
            <span className="tnum text-[15px] font-semibold text-ink">{health.score}</span>
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[13px] font-semibold text-ink">Health score</p>
              <Badge variant={grade.variant} size="sm">
                {grade.label}
              </Badge>
            </div>
            <p className="mt-0.5 text-[12px] text-ink-muted">{health.summary}</p>
          </div>
        </div>
      </div>

      <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {health.factors.map((factor) => (
          <li
            key={factor.label + factor.detail}
            className="flex items-start gap-2 rounded-lg bg-surface px-3 py-2"
          >
            <span
              className={cn(
                'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
                factor.positive ? 'bg-positive' : 'bg-negative',
              )}
              aria-hidden="true"
            />
            <span className="text-[12px] leading-relaxed text-ink-muted">
              <span className="font-medium text-ink">{factor.label}: </span>
              {factor.detail}
            </span>
          </li>
        ))}
      </ul>

      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 border-t border-hairline pt-5 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              {stat.label}
            </dt>
            <dd className="tnum mt-1 text-[14px] font-medium text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {history.length >= 2 && (
        <div className="space-y-2.5">
          <div>
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              Margin over time
            </p>
            <p className="mt-1 text-[12px] text-ink-subtle">
              Margin rate against the portfolio average, with realised unit price behind it — a
              margin falling while price holds points at cost, both falling points at discounting.
            </p>
          </div>
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <MarginTrendChart
              history={history}
              portfolioMarginPct={snapshot.totals.marginPct}
            />
            <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-muted">
              <span className="flex items-center gap-1.5">
                <span className="h-0.5 w-4 rounded-full bg-accent" />
                Margin %
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="h-0.5 w-4 rounded-full"
                  style={{
                    backgroundImage:
                      'repeating-linear-gradient(to right, var(--caution) 0 3px, transparent 3px 6px)',
                  }}
                />
                Avg unit price (right axis)
              </span>
            </div>
          </div>
        </div>
      )}

      {/* A brand or category is only actionable once you can see which of its
          products is responsible — the rollup names the problem, this names
          the listing to go and fix. */}
      {dimension !== 'product' && (
        <MemberProducts row={row} snapshot={snapshot} onDrillToProducts={onDrillToProducts} />
      )}

      {history.length >= 2 && <HistoryTable history={history} />}

      {ownInsights.length > 0 && (
        <div className="space-y-3">
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Findings
          </p>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {ownInsights.map((insight, index) => (
              <InsightCard key={insight.id} insight={insight} index={index} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * The products inside a brand or category rollup.
 *
 * Ranked by revenue with each one's own margin, so the founder can see whether
 * a weak brand is weak throughout or dragged down by one listing — which are
 * completely different problems with completely different fixes.
 */
function MemberProducts({
  row,
  snapshot,
  onDrillToProducts,
}: {
  row: CatalogueRow
  snapshot: Snapshot
  onDrillToProducts: () => void
}) {
  const members = useMemo(() => {
    const wanted = new Set(row.productKeys)
    return snapshot.products
      .filter((product) => wanted.has(product.productKey))
      .sort((a, b) => b.revenuePLN - a.revenuePLN)
  }, [row.productKeys, snapshot.products])

  if (members.length === 0) return null

  const peak = Math.max(...members.map((product) => product.revenuePLN), 1)

  return (
    <div className="space-y-2.5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Products in this {row.memberCount === 1 ? 'group' : 'group'}
          </p>
          <p className="mt-1 text-[12px] text-ink-subtle">
            {members.length} {members.length === 1 ? 'product' : 'products'} traded in this period,
            ranked by revenue.
          </p>
        </div>
        <button
          type="button"
          onClick={onDrillToProducts}
          className="text-[12px] font-medium text-accent-ink underline decoration-hairline-strong underline-offset-4 hover:decoration-accent"
        >
          Open the full product view
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[600px] text-left">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              <th className="pb-2 font-semibold">Product</th>
              <th className="pb-2 text-right font-semibold">Orders</th>
              <th className="pb-2 text-right font-semibold">Units</th>
              <th className="pb-2 pl-4 font-semibold">Revenue</th>
              <th className="pb-2 text-right font-semibold">Profit</th>
              <th className="pb-2 text-right font-semibold">Margin</th>
            </tr>
          </thead>
          <tbody>
            {members.map((product) => (
              <tr key={product.productKey} className="border-t border-hairline text-[12px]">
                <td className="max-w-[280px] py-2 pr-4">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-ink" title={product.label}>
                      {product.label}
                    </span>
                    {product.costUnknown && (
                      <Tooltip content="No landed cost on file — this product's profit is overstated.">
                        <AlertCircle
                          className="h-3 w-3 shrink-0 text-caution"
                          aria-label="Cost missing"
                        />
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="tnum py-2 text-right text-ink-muted">
                  {formatNumber(product.orders)}
                </td>
                <td className="tnum py-2 text-right text-ink-muted">
                  {formatNumber(product.units)}
                </td>
                <td className="py-2 pl-4">
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                      <div
                        className="h-full rounded-full bg-accent"
                        style={{
                          width: `${Math.max(2, (product.revenuePLN / peak) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="tnum text-ink">{formatPLN(product.revenuePLN)}</span>
                  </div>
                </td>
                <td
                  className={cn(
                    'tnum py-2 text-right',
                    product.marginPLN < 0 ? 'font-medium text-negative' : 'text-ink',
                  )}
                >
                  {formatPLN(product.marginPLN)}
                </td>
                <td
                  className={cn(
                    'tnum py-2 text-right',
                    product.marginPct < 15 ? 'font-medium text-negative' : 'text-ink-muted',
                  )}
                >
                  {formatPercent(product.marginPct)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/**
 * Monthly history as a compact table rather than a chart. At this size a chart
 * of six points communicates less than six labelled rows, and margin and unit
 * price need to be read against each other rather than eyeballed.
 */
function HistoryTable({ history }: { history: ReturnType<typeof buildCatalogueHistory> }) {
  const recent = history.slice(-6)
  const peakRevenue = Math.max(...recent.map((point) => point.revenuePLN), 1)

  return (
    <div className="space-y-2.5">
      <div>
        <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
          Monthly history
        </p>
        {/* The figures above are scoped to the selected period; this table is
            not. Saying so prevents it reading as a contradiction. */}
        <p className="mt-1 text-[12px] text-ink-subtle">
          Every month on record, regardless of the period selected above.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[520px] text-left">
          <thead>
            <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              <th className="pb-2 font-semibold">Month</th>
              <th className="pb-2 font-semibold">Revenue</th>
              <th className="pb-2 text-right font-semibold">Profit</th>
              <th className="pb-2 text-right font-semibold">Margin</th>
              <th className="pb-2 text-right font-semibold">Units</th>
              <th className="pb-2 text-right font-semibold">Avg price</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((point, index) => {
              const previous = index > 0 ? recent[index - 1] : undefined
              const marginShift = previous ? point.marginPct - previous.marginPct : 0
              return (
                <tr key={point.date} className="border-t border-hairline text-[12px]">
                  <td className="py-2 text-ink-muted">
                    {new Date(`${point.date}T00:00:00Z`).toLocaleDateString('en-GB', {
                      month: 'short',
                      year: '2-digit',
                      timeZone: 'UTC',
                    })}
                  </td>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-sunken">
                        <div
                          className="h-full rounded-full bg-accent"
                          style={{
                            width: `${Math.max(2, (point.revenuePLN / peakRevenue) * 100)}%`,
                          }}
                        />
                      </div>
                      <span className="tnum text-ink">{formatPLN(point.revenuePLN)}</span>
                    </div>
                  </td>
                  <td className="tnum py-2 text-right text-ink">{formatPLN(point.marginPLN)}</td>
                  <td
                    className={cn(
                      'tnum py-2 text-right',
                      point.marginPct < 15 ? 'text-negative' : 'text-ink-muted',
                    )}
                  >
                    {formatPercent(point.marginPct)}
                    {previous && Math.abs(marginShift) >= 1 && (
                      <span
                        className={cn(
                          'ml-1 text-[10px]',
                          marginShift > 0 ? 'text-positive' : 'text-negative',
                        )}
                      >
                        {marginShift > 0 ? '▲' : '▼'}
                      </span>
                    )}
                  </td>
                  <td className="tnum py-2 text-right text-ink-muted">
                    {formatNumber(point.units)}
                  </td>
                  <td className="tnum py-2 text-right text-ink-muted">
                    {formatPLN(point.avgUnitPricePLN)}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
