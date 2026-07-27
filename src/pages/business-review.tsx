import { motion } from 'framer-motion'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { useMemo, useState } from 'react'

import { AnalyticsChart, ChartLegend } from '@/components/charts/analytics-chart'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { PeriodSelector } from '@/components/period-selector'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import {
  buildAnalyticsSeries,
  buildHeatmap,
  METRIC_DEFINITIONS,
  type AnalyticsMetric,
  type OverlayKey,
} from '@/domain/analytics'
import { buildBusinessReview } from '@/domain/review'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

const TREND_METRICS: AnalyticsMetric[] = ['revenue', 'profit', 'margin', 'orders']

const HEATMAP_DIMENSIONS = [
  { value: 'brand' as const, label: 'Brands' },
  { value: 'product' as const, label: 'Products' },
  { value: 'category' as const, label: 'Categories' },
]

const TONE_ICON = {
  positive: TrendingUp,
  negative: TrendingDown,
  neutral: Minus,
}

/**
 * Executive reporting, not a second catalogue.
 *
 * The product scoreboard that used to live here now belongs to the Products
 * page; repeating it made this a table with a paragraph on top. What remains is
 * the report itself: headline figures, the written reading, generated
 * observations, then trends and concentration.
 */
export function BusinessReviewPage() {
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

  const [trendMetric, setTrendMetric] = useState<AnalyticsMetric>('revenue')
  const [heatmapDimension, setHeatmapDimension] = useState<'product' | 'brand' | 'category'>('brand')

  const review = useMemo(
    () => (snapshot && context ? buildBusinessReview(snapshot, context.coverage) : null),
    [snapshot, context],
  )

  const series = useMemo(() => {
    if (!context || !period) return null
    return buildAnalyticsSeries({
      allOrders: context.orders,
      period,
      metric: trendMetric,
    })
  }, [context, period, trendMetric])

  const heatmap = useMemo(() => {
    if (!context) return null
    return buildHeatmap(context.orders, heatmapDimension, 'revenue')
  }, [context, heatmapDimension])

  if (isLoading) return <PageSkeleton />
  if (isError || !snapshot || !review || !period || !series) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Business Review" title="Business Review" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const overlays: Record<OverlayKey, boolean> = {
    previous: true,
    lastYear: false,
    movingAverage: true,
    forecast: false,
  }

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Business Review"
        title="The state of Luora, written down"
        description={review.periodLabel}
        actions={
          <PeriodSelector
            value={periodKey}
            label={period.label}
            onChange={(key) => {
              setCustomRange(null)
              setPeriodKey(key)
            }}
            onCustom={(from, to) => {
              setCustomRange({ from, to })
              setPeriodKey('custom')
            }}
          />
        }
      />

      {/* ── Executive summary ──────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeading title="Executive summary" />
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          {review.summary.map((item, index) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
            >
              <Card className="h-full">
                <div className="p-5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    {item.label}
                  </p>
                  <p className="tnum mt-2 text-[22px] font-semibold leading-none tracking-[-0.03em] text-ink">
                    {item.value}
                  </p>
                  <p className="mt-2 text-[12px] capitalize text-ink-muted">{item.caption}</p>
                </div>
              </Card>
            </motion.div>
          ))}
        </div>
      </section>

      {/* ── The written report ─────────────────────────────────────────── */}
      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card>
          <CardContent className="max-w-3xl space-y-5 p-8">
            {review.narrative.map((paragraph, index) => (
              <p
                key={paragraph.slice(0, 40)}
                className={cn(
                  'leading-relaxed',
                  index === 0
                    ? 'text-[17px] font-medium tracking-[-0.01em] text-ink'
                    : 'text-[14px] text-ink-muted',
                )}
              >
                {paragraph}
              </p>
            ))}
          </CardContent>
        </Card>
      </motion.section>

      {/* ── Generated observations ─────────────────────────────────────── */}
      {review.insights.length > 0 && (
        <section className="space-y-5">
          <SectionHeading
            title="Business insights"
            description="Observations generated from this period's figures. Each states a finding, not a metric."
          />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {review.insights.map((insight, index) => {
              const Icon = TONE_ICON[insight.tone]
              return (
                <motion.div
                  key={insight.topic + insight.statement.slice(0, 20)}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, delay: index * 0.05, ease: [0.16, 1, 0.3, 1] }}
                >
                  <Card className="h-full">
                    <div className="flex items-start gap-3 p-5">
                      <span
                        className={cn(
                          'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full',
                          insight.tone === 'positive'
                            ? 'bg-positive-soft text-positive'
                            : insight.tone === 'negative'
                              ? 'bg-negative-soft text-negative'
                              : 'bg-surface-sunken text-ink-muted',
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                      </span>
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                          {insight.topic}
                        </p>
                        <p className="mt-1 text-[14px] leading-relaxed text-ink">
                          {insight.statement}
                        </p>
                      </div>
                    </div>
                  </Card>
                </motion.div>
              )
            })}
          </div>
        </section>
      )}

      {/* ── Business trends ────────────────────────────────────────────── */}
      <section className="space-y-5">
        <SectionHeading
          title="Business trends"
          description={METRIC_DEFINITIONS[trendMetric].description}
          actions={
            <Segmented
              options={TREND_METRICS.map((metric) => ({
                value: metric,
                label: METRIC_DEFINITIONS[metric].label,
              }))}
              value={trendMetric}
              onChange={setTrendMetric}
              aria-label="Trend metric"
            />
          }
        />
        <Card>
          <CardContent className="p-6 pt-7">
            {series.points.length >= 2 ? (
              <>
                <AnalyticsChart series={series} overlays={overlays} height={280} />
                <ChartLegend overlays={overlays} available={series.available} />
              </>
            ) : (
              <EmptyState title="Not enough buckets to plot" />
            )}
          </CardContent>
        </Card>
      </section>

      {/* ── Concentration heatmap ──────────────────────────────────────── */}
      {heatmap && heatmap.rows.length > 0 && (
        <section className="space-y-5">
          <SectionHeading
            title="Where revenue concentrates"
            description="Monthly revenue by row, shaded against the strongest cell. Reads as a map of what the business actually depends on."
            actions={
              <Segmented
                options={HEATMAP_DIMENSIONS}
                value={heatmapDimension}
                onChange={setHeatmapDimension}
                aria-label="Heatmap dimension"
              />
            }
          />
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[680px] border-collapse text-left">
                <thead>
                  <tr className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                    <th className="px-5 py-3 font-semibold">
                      {heatmapDimension === 'product'
                        ? 'Product'
                        : heatmapDimension === 'brand'
                          ? 'Brand'
                          : 'Category'}
                    </th>
                    {heatmap.columns.map((column) => (
                      <th key={column} className="px-2 py-3 text-center font-semibold">
                        {new Date(`${column}-01T00:00:00Z`).toLocaleDateString('en-GB', {
                          month: 'short',
                          year: '2-digit',
                          timeZone: 'UTC',
                        })}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {heatmap.rows.map((row) => (
                    <tr key={row} className="border-t border-hairline">
                      <td
                        className="max-w-[260px] truncate px-5 py-2.5 text-[13px] text-ink"
                        title={row}
                      >
                        {row}
                      </td>
                      {heatmap.columns.map((column) => {
                        const cell = heatmap.cells.find(
                          (item) => item.row === row && item.column === column,
                        )
                        const intensity = cell?.intensity ?? 0
                        return (
                          <td key={column} className="px-1 py-1.5 text-center">
                            <Tooltip
                              content={`${row} · ${column}: ${formatPLN(cell?.value ?? 0)}`}
                            >
                              <span
                                className="mx-auto flex h-8 w-full min-w-[52px] cursor-help items-center justify-center rounded-md text-[11px] font-medium"
                                style={{
                                  backgroundColor:
                                    intensity > 0.02
                                      ? `color-mix(in srgb, var(--accent) ${Math.round(intensity * 100)}%, transparent)`
                                      : 'var(--surface-sunken)',
                                  color: intensity > 0.55 ? 'white' : 'var(--ink-muted)',
                                }}
                              >
                                {/* Rounding to thousands renders 400 zł as
                                    "0k", which reads as nothing sold. */}
                                {!cell || cell.value === 0
                                  ? '—'
                                  : cell.value < 1000
                                    ? '<1k'
                                    : `${Math.round(cell.value / 1000)}k`}
                              </span>
                            </Tooltip>
                          </td>
                        )
                      })}
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
