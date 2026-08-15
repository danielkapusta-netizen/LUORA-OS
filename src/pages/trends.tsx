import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'

import { AnalyticsChart, ChartLegend } from '@/components/charts/analytics-chart'
import { Delta } from '@/components/delta'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { PeriodSelector } from '@/components/period-selector'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { Tooltip } from '@/components/ui/tooltip'
import {
  availableGranularities,
  buildAnalyticsSeries,
  METRIC_DEFINITIONS,
  METRIC_ORDER,
  type AnalyticsMetric,
  type OverlayKey,
} from '@/domain/analytics'
import { buildWeekdayPattern } from '@/domain/trends'
import type { Granularity } from '@/domain/types'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatNumber, formatPercent, formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'
import { rise } from '@/lib/motion'

const GRANULARITY_LABELS: Record<Granularity, string> = {
  day: 'Daily',
  week: 'Weekly',
  month: 'Monthly',
  quarter: 'Quarterly',
  year: 'Yearly',
}

const OVERLAY_LABELS: Array<{ key: OverlayKey; label: string }> = [
  { key: 'previous', label: 'Previous period' },
  { key: 'lastYear', label: 'Last year' },
  { key: 'movingAverage', label: 'Moving average' },
  { key: 'forecast', label: 'Forecast' },
]

/**
 * An analytics workspace, not a wall of charts.
 *
 * One metric is examined at a time, at full size, with every comparison
 * available against it. Switching metric keeps the grain and overlays intact,
 * so the founder builds one mental frame and moves it across the business
 * rather than re-reading a new layout six times.
 */
export function TrendsPage() {
  const {
    context,
    period,
    periodKey,
    setPeriodKey,
    setCustomRange,
    isLoading,
    isError,
    error,
    refetch,
  } = useSnapshot()

  const [metric, setMetric] = useState<AnalyticsMetric>('revenue')
  const [granularity, setGranularity] = useState<Granularity | null>(null)
  const [overlays, setOverlays] = useState<Record<OverlayKey, boolean>>({
    previous: true,
    lastYear: false,
    movingAverage: true,
    forecast: false,
  })

  const grains = useMemo(() => (period ? availableGranularities(period) : []), [period])
  const activeGrain = granularity && grains.includes(granularity) ? granularity : period?.granularity

  const series = useMemo(() => {
    if (!context || !period || !activeGrain) return null
    return buildAnalyticsSeries({
      allOrders: context.orders,
      period,
      metric,
      granularity: activeGrain,
    })
  }, [context, period, metric, activeGrain])

  const weekdays = useMemo(() => {
    if (!context || !period) return []
    const inPeriod = context.daily.filter((point) => {
      const time = new Date(`${point.date}T00:00:00Z`).getTime()
      return time >= period.from.getTime() && time <= period.to.getTime()
    })
    return buildWeekdayPattern(inPeriod)
  }, [context, period])

  if (isLoading) return <PageSkeleton />
  if (isError || !context || !period || !series || !activeGrain) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Trends" title="Trends" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const definition = METRIC_DEFINITIONS[metric]
  const formatValue = (value: number) =>
    definition.format === 'pln'
      ? formatPLN(value)
      : definition.format === 'percent'
        ? formatPercent(value)
        : formatNumber(value)

  return (
    <div className="space-y-10">
      <PageHeader
        eyebrow="Trends"
        title="Analytics workspace"
        description={`${context.coverage.tradingDays} trading days on record. Choose a measure, a grain, and what to compare it against.`}
        actions={
          <PeriodSelector
            value={periodKey}
            label={period.label}
            onChange={(key) => {
              setCustomRange(null)
              setPeriodKey(key)
              setGranularity(null)
            }}
            onCustom={(from, to) => {
              setCustomRange({ from, to })
              setPeriodKey('custom')
              setGranularity(null)
            }}
          />
        }
      />

      {/* Metric selector — each is a section of the workspace, not a tab. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {METRIC_ORDER.map((key) => {
          const item = METRIC_DEFINITIONS[key]
          const isActive = key === metric
          return (
            <button
              key={key}
              type="button"
              onClick={() => setMetric(key)}
              aria-pressed={isActive}
              className={cn(
                'rounded-control border px-3 py-2.5 text-left transition-colors duration-150',
                isActive
                  ? 'border-accent/40 bg-accent-soft text-accent-ink'
                  : 'border-hairline bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink',
              )}
            >
              <span className="block t-small font-medium">{item.label}</span>
            </button>
          )
        })}
      </div>

      <section className="space-y-5">
        <SectionHeading
          title={definition.label}
          description={definition.description}
          actions={
            <div className="flex flex-wrap items-center gap-2">
              {grains.length > 1 && (
                <Segmented
                  options={grains.map((grain) => ({
                    value: grain,
                    label: GRANULARITY_LABELS[grain],
                  }))}
                  value={activeGrain}
                  onChange={(value) => setGranularity(value)}
                  aria-label="Chart grain"
                />
              )}
            </div>
          }
        />

        {/* Headline for the selected metric, so the chart is never the only
            place the number appears. */}
        <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="t-label text-ink-subtle">
              {period.label}
            </p>
            <p className="tnum mt-1 text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink">
              {formatValue(series.total)}
            </p>
          </div>
          <div className="flex items-center gap-2 pb-1">
            {period.previousCoverage === 'full' ? (
              <>
                <Delta
                  value={series.changePct}
                  unit={metric === 'margin' ? 'pp' : 'percent'}
                  higherIsBetter={definition.higherIsBetter}
                  size="md"
                />
                <span className="t-caption text-ink-subtle">{period.comparisonLabel}</span>
              </>
            ) : (
              <Tooltip content="The equal-length window before this period reaches back before your first order, so a percentage against it would compare trading to a time when there was none.">
                <span className="cursor-help t-caption text-ink-subtle underline decoration-hairline-strong decoration-dotted underline-offset-4">
                  No comparable earlier period
                </span>
              </Tooltip>
            )}
          </div>
          {series.projectedTotal !== null && overlays.forecast && (
            <Tooltip content="A straight-line projection from recent trade. It does not model seasonality or campaigns — treat it as a pace check, not a plan.">
              <div className="cursor-help pb-1">
                <p className="t-label text-ink-subtle">
                  Projected full period
                </p>
                <p className="tnum mt-1 text-[16px] font-semibold text-positive">
                  {formatValue(series.projectedTotal)}
                </p>
              </div>
            </Tooltip>
          )}
        </div>

        {/* Overlay toggles, disabled where the data cannot support them. */}
        <div className="flex flex-wrap items-center gap-2">
          {OVERLAY_LABELS.map(({ key, label }) => {
            const isAvailable = series.available[key]
            const isOn = overlays[key] && isAvailable
            return (
              <Tooltip
                key={key}
                content={
                  isAvailable
                    ? label === 'Forecast'
                      ? 'Straight-line projection from recent buckets.'
                      : `Compare against ${label.toLowerCase()}.`
                    : `Not enough history in this period for ${label.toLowerCase()}.`
                }
              >
                <button
                  type="button"
                  disabled={!isAvailable}
                  aria-pressed={isOn}
                  onClick={() => setOverlays((current) => ({ ...current, [key]: !current[key] }))}
                  className={cn(
                    'rounded-full border px-3 py-1.5 t-caption font-medium transition-colors duration-150',
                    !isAvailable && 'cursor-not-allowed border-hairline text-ink-subtle opacity-50',
                    isAvailable && isOn && 'border-accent/40 bg-accent-soft text-accent-ink',
                    isAvailable &&
                      !isOn &&
                      'border-hairline bg-surface text-ink-muted hover:bg-surface-sunken hover:text-ink',
                  )}
                >
                  {label}
                </button>
              </Tooltip>
            )
          })}
        </div>

        <Card>
          <CardContent className="p-6 pt-7">
            {series.points.length >= 2 ? (
              <>
                <AnalyticsChart series={series} overlays={overlays} />
                <ChartLegend overlays={overlays} available={series.available} />
              </>
            ) : (
              <EmptyState
                title="Not enough buckets to plot"
                description="Choose a longer period or a finer grain."
              />
            )}
          </CardContent>
        </Card>
      </section>

      {weekdays.some((day) => day.occurrences > 0) && (
        <motion.section
          {...rise()}
          className="space-y-5"
        >
          <SectionHeading
            title="Weekday rhythm"
            description="Average revenue per occurrence of each weekday in this period, so uneven ranges compare fairly."
          />
          <Card>
            <CardContent className="p-6">
              <ul className="space-y-3.5">
                {weekdays.map((day, index) => {
                  const max = Math.max(...weekdays.map((item) => item.avgRevenuePLN), 1)
                  return (
                    <li key={day.label} className="flex items-center gap-3">
                      <span className="w-9 shrink-0 t-caption font-medium text-ink-muted">
                        {day.label}
                      </span>
                      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                        <motion.div
                          className="h-full rounded-full bg-accent"
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.max(1, (day.avgRevenuePLN / max) * 100)}%` }}
                          transition={{ duration: 0.7, delay: 0.04 * index, ease: [0.16, 1, 0.3, 1] }}
                        />
                      </div>
                      <span className="tnum w-24 shrink-0 text-right t-caption text-ink">
                        {formatPLN(day.avgRevenuePLN)}
                      </span>
                      <span className="tnum w-12 shrink-0 text-right t-micro text-ink-subtle">
                        {day.occurrences}×
                      </span>
                    </li>
                  )
                })}
              </ul>
            </CardContent>
          </Card>
        </motion.section>
      )}
    </div>
  )
}
