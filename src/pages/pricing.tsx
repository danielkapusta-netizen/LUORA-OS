import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ChevronDown, Search, TrendingDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader, SectionHeading } from '@/components/page-header'
import {
  MarginHealthScale,
  MarginTargets,
  PricingSimulator,
  ProfitWaterfall,
  RecommendationBlock,
  StatusDot,
} from '@/components/pricing/blocks'
import { MarginTrendChart, PriceStabilityChart } from '@/components/pricing/charts'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import { inferBrand } from '@/domain/orders'
import {
  buildPricingWorkspace,
  buildPriceHistory,
  buildWaterfall,
  PRICING_PERIODS,
  type PricingPeriodKey,
  type PricingRow,
} from '@/domain/pricing'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatNumber, formatPercent, formatPLN, formatPLNExact } from '@/lib/format'
import { cn } from '@/lib/utils'
import { disclosure } from '@/lib/motion'

const DIMENSION_OPTIONS = [
  { value: 'product' as const, label: 'Products' },
  { value: 'brand' as const, label: 'Brands' },
]

/**
 * The pricing control centre.
 *
 * One question governs the page: is each product priced correctly, and what is
 * the gap worth. The table is the workspace; everything else — targets,
 * simulator, waterfall, trend — lives inside the expanded row so analysis
 * happens next to the number it explains, never in a parallel section the
 * reader must reconcile by scrolling.
 */
export function PricingPage() {
  const { context, isLoading, isError, error, refetch } = useSnapshot()

  const [dimension, setDimension] = useState<'product' | 'brand'>('product')
  const [period, setPeriod] = useState<PricingPeriodKey>('last5')
  const [search, setSearch] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)

  const workspace = useMemo(() => {
    if (!context || !context.coverage.lastOrder) return null
    return buildPricingWorkspace({
      orders: context.orders,
      costs: context.costs,
      dimension,
      period,
      anchor: context.coverage.lastOrder,
      brandOf: inferBrand,
    })
  }, [context, dimension, period])

  if (isLoading) return <PageSkeleton />
  if (isError || !context || !workspace) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Pricing" title="Pricing Intelligence" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const { summary } = workspace
  const query = search.trim().toLowerCase()
  const visible = query
    ? workspace.rows.filter((row) => row.label.toLowerCase().includes(query))
    : workspace.rows
  const atRisk = workspace.rows.filter((row) => row.risk !== null)
  const periodLabel = PRICING_PERIODS.find((option) => option.value === period)?.label ?? ''
  const noun = dimension === 'brand' ? 'brands' : 'products'

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Pricing"
        title="Pricing Intelligence"
        description={
          summary.onTheTablePLN > 0 ? (
            <>
              Across {summary.productCount} {noun}, roughly{' '}
              <span className="tnum font-semibold text-ink">
                {formatPLN(summary.onTheTablePLN)}
              </span>{' '}
              of monthly profit sits on the table in under-priced listings.
            </>
          ) : (
            `Every ${dimension} priced above the healthy line — nothing obviously on the table.`
          )
        }
      />

      {/* ── Executive summary ─────────────────────────────────────────── */}
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <SummaryStat
          label="Portfolio margin"
          value={formatPercent(summary.avgMarginPct)}
          tone={summary.avgMarginPct >= 15 ? 'positive' : summary.avgMarginPct >= 10 ? 'neutral' : 'negative'}
          caption="last 30 days"
        />
        <SummaryStat
          label="Profit on the table"
          value={formatPLN(summary.onTheTablePLN)}
          tone={summary.onTheTablePLN > 0 ? 'accent' : 'neutral'}
          caption="per month, if repriced"
        />
        <SummaryStat
          label="Healthy (>15%)"
          value={String(summary.aboveFifteen)}
          tone="positive"
          caption={`of ${summary.productCount} ${noun}`}
        />
        <SummaryStat
          label="Thin (10–15%)"
          value={String(summary.tenToFifteen)}
          tone="neutral"
          caption="worth a price test"
        />
        <SummaryStat
          label="Unhealthy (<10%)"
          value={String(summary.belowTenPct)}
          tone={summary.belowTenPct > 0 ? 'negative' : 'neutral'}
          caption="need a decision"
        />
      </section>

      {/* ── Filters ───────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={DIMENSION_OPTIONS}
            value={dimension}
            onChange={(value) => {
              setDimension(value)
              setOpenKey(null)
            }}
            aria-label="View by"
          />
          {/* Seven options exceed a phone's width; the control scrolls inside
              its own row rather than pushing the whole page sideways. */}
          <div className="max-w-full overflow-x-auto">
            <Segmented
              options={PRICING_PERIODS}
              value={period}
              onChange={(value) => {
                setPeriod(value)
                setOpenKey(null)
              }}
              aria-label="Statistics window"
            />
          </div>
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
            className="h-9 w-full rounded-control border border-hairline bg-surface pl-9 pr-3 t-small text-ink placeholder:text-ink-subtle"
          />
        </label>
      </div>

      {/* ── Pricing table ─────────────────────────────────────────────── */}
      {visible.length === 0 ? (
        <Card>
          <EmptyState title={`No ${noun} match`} description="Clear the search or widen the period." />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden border-b border-hairline bg-surface-sunken/50 px-5 py-2.5 t-label text-ink-subtle lg:grid lg:grid-cols-[24px_1fr_96px_110px_100px_84px_110px_110px_28px] lg:gap-3">
            <span />
            <span>{dimension === 'brand' ? 'Brand' : 'Product'}</span>
            <span className="text-right">Current</span>
            <span className="text-right">Avg ({periodLabel.toLowerCase()})</span>
            <span className="text-right">Avg profit</span>
            <span className="text-right">Margin</span>
            <span className="text-right">Monthly profit</span>
            <span className="text-right">Monthly revenue</span>
            <span />
          </div>
          <ul>
            {visible.map((row) => (
              <PricingTableRow
                key={row.key}
                row={row}
                isOpen={openKey === row.key}
                onToggle={() => setOpenKey(openKey === row.key ? null : row.key)}
              />
            ))}
          </ul>
        </Card>
      )}

      {/* ── Margin at risk ────────────────────────────────────────────── */}
      {atRisk.length > 0 && (
        <section className="space-y-5">
          <SectionHeading
            title="Margin at risk"
            description="Products whose margin has declined for consecutive months. These pair with the margin trend inside each row — the list says who, the chart says how fast."
          />
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] text-left">
                <thead>
                  <tr className="border-b border-hairline bg-surface-sunken/50 t-label text-ink-subtle">
                    <th className="px-5 py-2.5 font-semibold">Product</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Current margin</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Was</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Trend</th>
                    <th className="px-3 py-2.5 text-right font-semibold">Est. monthly impact</th>
                    <th className="px-5 py-2.5 font-semibold">Recommendation</th>
                  </tr>
                </thead>
                <tbody>
                  {atRisk.map((row) => (
                    <tr key={row.key} className="border-b border-hairline t-small last:border-b-0">
                      <td className="max-w-[240px] truncate px-5 py-3 font-medium text-ink" title={row.label}>
                        {row.label}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-negative">
                        {formatPercent(row.risk!.currentMarginPct)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-ink-muted">
                        {formatPercent(row.risk!.previousMarginPct)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Badge variant="negative" size="sm">
                          <TrendingDown className="h-3 w-3" aria-hidden="true" />
                          {row.risk!.streak} months
                        </Badge>
                      </td>
                      <td className="tnum px-3 py-3 text-right text-ink">
                        −{formatPLN(row.risk!.estMonthlyImpactPLN)}
                      </td>
                      <td className="max-w-[260px] px-5 py-3 t-caption text-ink-muted">
                        {row.recommendation.kind === 'raise' && row.recommendation.recommendedPricePLN
                          ? `Reprice to ${formatPLNExact(row.recommendation.recommendedPricePLN)}`
                          : row.recommendation.kind === 'fix-costs'
                            ? 'Review landed cost — pricing cannot fix this'
                            : 'Investigate cost drift before it breaches 15%'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        </section>
      )}
    </div>
  )
}

function SummaryStat({
  label,
  value,
  caption,
  tone,
}: {
  label: string
  value: string
  caption: string
  tone: 'positive' | 'negative' | 'neutral' | 'accent'
}) {
  return (
    <Card>
      <div className="p-5">
        <p className="t-label text-ink-subtle">{label}</p>
        <p
          className={cn(
            'tnum mt-2 text-[24px] font-semibold leading-none tracking-[-0.03em]',
            tone === 'positive' && 'text-positive',
            tone === 'negative' && 'text-negative',
            tone === 'accent' && 'text-accent-ink',
            tone === 'neutral' && 'text-ink',
          )}
        >
          {value}
        </p>
        <p className="mt-2 t-caption text-ink-muted">{caption}</p>
      </div>
    </Card>
  )
}

function PricingTableRow({
  row,
  isOpen,
  onToggle,
}: {
  row: PricingRow
  isOpen: boolean
  onToggle: () => void
}) {
  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'press-sm grid w-full grid-cols-[24px_1fr_28px] items-center gap-3 px-5 py-3.5 text-left transition-colors duration-150 hover:bg-surface-sunken/50',
          'lg:grid-cols-[24px_1fr_96px_110px_100px_84px_110px_110px_28px]',
          isOpen && 'bg-surface-sunken/50',
        )}
      >
        <StatusDot status={row.status} />
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate t-small font-medium text-ink" title={row.label}>
              {row.label}
            </span>
            {row.costUnknown && (
              <Tooltip content="Landed cost missing for at least part of this row — profit figures are overstated.">
                <AlertCircle className="h-3.5 w-3.5 shrink-0 text-caution" aria-label="Cost missing" />
              </Tooltip>
            )}
          </span>
          <span className="mt-0.5 block t-micro text-ink-subtle lg:hidden">
            {formatPLNExact(row.averagePricePLN)} avg · {formatPercent(row.averageMarginPct)} margin
          </span>
        </span>
        <span className="tnum hidden text-right t-small text-ink lg:block">
          {formatPLNExact(row.currentPricePLN)}
        </span>
        <span className="tnum hidden text-right t-small text-ink lg:block">
          {formatPLNExact(row.averagePricePLN)}
        </span>
        <span
          className={cn(
            'tnum hidden text-right t-small lg:block',
            row.averageProfitPLN < 0 ? 'font-medium text-negative' : 'text-ink',
          )}
        >
          {formatPLNExact(row.averageProfitPLN)}
        </span>
        <span
          className={cn(
            'tnum hidden text-right t-small lg:block',
            row.status === 'red'
              ? 'font-medium text-negative'
              : row.status === 'yellow'
                ? 'text-caution'
                : 'text-positive',
          )}
        >
          {formatPercent(row.averageMarginPct)}
        </span>
        <span
          className={cn(
            'tnum hidden text-right t-small lg:block',
            row.monthlyProfitPLN < 0 ? 'font-medium text-negative' : 'text-ink',
          )}
        >
          {formatPLN(row.monthlyProfitPLN)}
        </span>
        <span className="tnum hidden text-right t-small text-ink-muted lg:block">
          {formatPLN(row.monthlyRevenuePLN)}
        </span>
        <ChevronDown
          className={cn(
            'h-4 w-4 justify-self-end text-ink-subtle transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={disclosure.initial}
            animate={disclosure.animate}
            exit={disclosure.exit}
            transition={disclosure.transition}
            className="overflow-hidden"
          >
            <ExpandedRow row={row} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function Block({
  title,
  description,
  children,
  className,
}: {
  title: string
  description?: string
  children: React.ReactNode
  className?: string
}) {
  return (
    <div className={cn('rounded-xl border border-hairline bg-surface p-5', className)}>
      <p className="t-caption font-semibold uppercase tracking-[0.06em] text-ink-muted">{title}</p>
      {description && <p className="mt-1 t-caption text-ink-subtle">{description}</p>}
      <div className="mt-4">{children}</div>
    </div>
  )
}

function ExpandedRow({ row }: { row: PricingRow }) {
  const waterfall = useMemo(() => buildWaterfall(row), [row])
  // Charts read full history — a five-sale window cannot show a trend, and the
  // stats above the chart already answer the window-scoped question.
  const fullHistory = useMemo(() => buildPriceHistory(row.allLines), [row.allLines])

  return (
    <div className="space-y-5 border-t border-hairline bg-surface-sunken/40 p-6">
      {/* Current pricing + profitability, side by side. */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Block title="Current pricing" description="Realised unit prices in the selected window — a wide low/high gap means discounting.">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
            <PriceFact label="Current price" value={formatPLNExact(row.stability.currentPricePLN)} strong />
            <PriceFact label="Average price" value={formatPLNExact(row.stability.averagePricePLN)} />
            <PriceFact label="Lowest recent" value={formatPLNExact(row.stability.minPricePLN)} />
            <PriceFact label="Highest recent" value={formatPLNExact(row.stability.maxPricePLN)} />
          </dl>
        </Block>

        <Block title="Recent profitability" description="Per-order averages across the selected window.">
          <dl className="grid grid-cols-2 gap-x-8 gap-y-3">
            <PriceFact
              label="Avg profit / order"
              value={formatPLNExact(row.averageProfitPLN)}
              strong
              tone={row.averageProfitPLN >= 0 ? undefined : 'negative'}
            />
            <PriceFact label="Avg margin" value={formatPercent(row.averageMarginPct)} />
            <PriceFact
              label="Avg marketplace fee"
              value={`${formatPLNExact(row.avgCommissionPLN)} (${(row.commissionRate * 100).toFixed(1)}%)`}
            />
            <PriceFact label="Avg shipping" value={formatPLNExact(row.avgShippingPLN)} />
            <PriceFact
              label="Product cost / unit"
              value={row.unitCostPLN !== null ? formatPLNExact(row.unitCostPLN) : 'Not on file'}
              tone={row.unitCostPLN === null ? 'caution' : undefined}
            />
          </dl>
        </Block>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Block
          title="Margin targets"
          description="The exact price this product needs to reach each margin, after VAT and its own measured commission rate."
        >
          <MarginTargets row={row} />
        </Block>

        <div className="space-y-5">
          <Block title="Margin health">
            <MarginHealthScale health={row.health} />
          </Block>
          <Block
            title="Where each złoty goes"
            description="Per unit at the current average price, using the same formula the sheet's own margin follows."
          >
            {waterfall ? (
              <ProfitWaterfall steps={waterfall} />
            ) : (
              <p className="t-small text-ink-subtle">Needs a landed cost to draw.</p>
            )}
          </Block>
        </div>
      </div>

      <Block
        title="Pricing simulator"
        description="Type a price; margin, per-unit and monthly profit update as you type. Assumes volume holds."
      >
        <PricingSimulator row={row} />
      </Block>

      <Block title="Recommendation">
        <RecommendationBlock rec={row.recommendation} />
      </Block>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Block title="Margin trend" description="Direction over time. The dashed line is the 15% healthy threshold.">
          <MarginTrendChart lines={row.allLines} />
        </Block>

        <Block
          title="Price stability"
          description={`${row.stability.distinctPrices} distinct price${row.stability.distinctPrices === 1 ? '' : 's'} in the window · ${formatNumber(row.stability.volatilityPct)}% spread · average discount ${row.stability.avgDiscountPct.toFixed(1)}% off the top price.`}
        >
          <PriceStabilityChart points={fullHistory} averagePricePLN={row.stability.averagePricePLN} />
        </Block>
      </div>

      {row.risk && (
        <div className="flex items-start gap-3 rounded-xl border border-negative/25 bg-negative-soft/40 p-4">
          <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-negative" aria-hidden="true" />
          <p className="t-small text-ink">
            {row.risk.note} Estimated impact −{formatPLN(row.risk.estMonthlyImpactPLN)} per month at
            current volume.
          </p>
        </div>
      )}
    </div>
  )
}

function PriceFact({
  label,
  value,
  strong,
  tone,
}: {
  label: string
  value: string
  strong?: boolean
  tone?: 'negative' | 'caution'
}) {
  return (
    <div>
      <dt className="t-label text-ink-subtle">{label}</dt>
      <dd
        className={cn(
          'tnum mt-1',
          strong ? 'text-[17px] font-semibold tracking-[-0.01em]' : 't-body font-medium',
          tone === 'negative' ? 'text-negative' : tone === 'caution' ? 'text-caution' : 'text-ink',
        )}
      >
        {value}
      </dd>
    </div>
  )
}
