import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ChevronDown } from 'lucide-react'
import { useMemo, useState } from 'react'

import { TrendChart } from '@/components/charts/trend-chart'
import { InsightCard } from '@/components/insight-card'
import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import { channelName } from '@/domain/insights'
import { buildProductDaily } from '@/domain/trends'
import type { BusinessContext, ProductPerformance } from '@/domain/types'
import { useBusinessContext } from '@/hooks/use-business-context'
import { formatDate, formatNumber, formatPercent, formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

type SortKey = 'revenue' | 'margin' | 'marginPct' | 'orders'

const SORT_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
  { value: 'marginPct' as const, label: 'Margin %' },
  { value: 'orders' as const, label: 'Orders' },
]

function sortProducts(products: readonly ProductPerformance[], key: SortKey): ProductPerformance[] {
  const pick: Record<SortKey, (product: ProductPerformance) => number> = {
    revenue: (product) => product.revenuePLN,
    margin: (product) => product.marginPLN,
    marginPct: (product) => product.marginPct,
    orders: (product) => product.orders,
  }
  return [...products].sort((a, b) => pick[key](b) - pick[key](a))
}

/** Lifecycle read from the trading evidence available — honest at 10 days. */
function lifecycle(product: ProductPerformance, lastOrder: Date | null): string {
  if (product.orders <= 2) return 'Proving'
  if (
    lastOrder &&
    product.lastSold &&
    lastOrder.getTime() - product.lastSold.getTime() > 4 * 86_400_000
  )
    return 'Cooling'
  if (product.revenueShare >= 0.15) return 'Core'
  return 'Growing'
}

export function ProductsPage() {
  const { context, isLoading, isError, error, refetch } = useBusinessContext()
  const [sortKey, setSortKey] = useState<SortKey>('revenue')
  const [openKey, setOpenKey] = useState<string | null>(null)

  if (isLoading) return <PageSkeleton />
  if (isError || !context) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Products" title="Products" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const sorted = sortProducts(context.products, sortKey)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Products"
        title="Every product, scored"
        description={`${context.products.length} products across ${formatNumber(context.summary.totalOrders)} orders. Click any row for its full intelligence panel.`}
        actions={
          <Segmented
            options={SORT_OPTIONS}
            value={sortKey}
            onChange={setSortKey}
            aria-label="Sort products by"
          />
        }
      />

      {sorted.length === 0 ? (
        <Card>
          <EmptyState title="No products yet" />
        </Card>
      ) : (
        <div className="space-y-3">
          {sorted.map((product, index) => (
            <ProductRow
              key={product.productKey}
              product={product}
              rank={index + 1}
              context={context}
              isOpen={openKey === product.productKey}
              onToggle={() =>
                setOpenKey(openKey === product.productKey ? null : product.productKey)
              }
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ProductRow({
  product,
  rank,
  context,
  isOpen,
  onToggle,
}: {
  product: ProductPerformance
  rank: number
  context: BusinessContext
  isOpen: boolean
  onToggle: () => void
}) {
  const isThin = product.marginPct < 15
  const stage = lifecycle(product, context.coverage.lastOrder)

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
              <span className="truncate text-[14px] font-medium text-ink" title={product.label}>
                {product.label}
              </span>
              {product.costUnknown && (
                <Tooltip content="No landed cost on file — reported profit excludes COGS and is overstated.">
                  <AlertCircle className="h-3.5 w-3.5 shrink-0 text-caution" aria-label="Cost missing" />
                </Tooltip>
              )}
            </div>
            <p className="mt-0.5 text-[12px] text-ink-subtle">
              {product.orders} {product.orders === 1 ? 'order' : 'orders'} ·{' '}
              {product.channels.map(channelName).join(' + ')} · {stage}
            </p>
          </div>

          <div className="hidden shrink-0 items-baseline gap-6 sm:flex">
            <Figure label="Revenue" value={formatPLN(product.revenuePLN)} />
            <Figure label="Profit" value={formatPLN(product.marginPLN)} />
            <Figure
              label="Margin"
              value={formatPercent(product.marginPct)}
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
              <ProductDetail product={product} context={context} />
            </motion.div>
          )}
        </AnimatePresence>
      </Card>
    </motion.div>
  )
}

function Figure({
  label,
  value,
  tone,
}: {
  label: string
  value: string
  tone?: 'negative'
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
        {label}
      </p>
      <p className={cn('tnum text-[14px] font-semibold', tone === 'negative' ? 'text-negative' : 'text-ink')}>
        {value}
      </p>
    </div>
  )
}

function ProductDetail({
  product,
  context,
}: {
  product: ProductPerformance
  context: BusinessContext
}) {
  const daily = useMemo(
    () => buildProductDaily(context.orders, product.productKey, context.daily),
    [context.orders, context.daily, product.productKey],
  )
  const ownInsights = context.insights.filter(
    (insight) => insight.entity?.key === product.productKey,
  )
  const profitPerOrder = product.orders > 0 ? product.marginPLN / product.orders : 0

  const stats: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Units sold', value: formatNumber(product.units) },
    { label: 'Avg order value', value: formatPLN(product.avgOrderValuePLN) },
    { label: 'Profit per order', value: formatPLN(profitPerOrder) },
    {
      label: 'Revenue share',
      value: formatPercent(product.revenueShare * 100),
      hint: 'Share of all-time company revenue.',
    },
    {
      label: 'Profit share',
      value: formatPercent(product.marginShare * 100),
      hint: 'Share of all-time company profit.',
    },
    {
      label: 'Landed cost',
      value: product.unitCostPLN !== null ? formatPLN(product.unitCostPLN) : 'Not on file',
      hint:
        product.unitCostPLN !== null
          ? 'Per-unit landed cost from the product cost sheet.'
          : 'Add this product to the cost sheet to verify its margin.',
    },
    { label: 'First sold', value: formatDate(product.firstSold) },
    { label: 'Last sold', value: formatDate(product.lastSold) },
  ]

  return (
    <div className="space-y-6 border-t border-hairline bg-surface-sunken/40 p-6">
      <dl className="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-4">
        {stats.map((stat) => (
          <div key={stat.label}>
            {stat.hint ? (
              <Tooltip content={stat.hint}>
                <dt className="cursor-help text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle underline decoration-hairline-strong decoration-dotted underline-offset-4">
                  {stat.label}
                </dt>
              </Tooltip>
            ) : (
              <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                {stat.label}
              </dt>
            )}
            <dd className="tnum mt-1 text-[14px] font-medium text-ink">{stat.value}</dd>
          </div>
        ))}
      </dl>

      {daily.some((point) => point.revenuePLN > 0) && (
        <div>
          <p className="mb-3 text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
            Daily revenue
          </p>
          <div className="rounded-xl border border-hairline bg-surface p-4">
            <TrendChart data={daily} metric="revenue" height={180} />
          </div>
        </div>
      )}

      {ownInsights.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <p className="text-[12px] font-semibold uppercase tracking-[0.06em] text-ink-muted">
              Findings for this product
            </p>
            <Badge variant="accent" size="sm" className="tnum">
              {ownInsights.length}
            </Badge>
          </div>
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
