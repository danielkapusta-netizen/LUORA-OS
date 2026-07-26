import { motion } from 'framer-motion'
import { useId, useMemo, useState } from 'react'
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { type TrendMetric } from '@/components/charts/trend-chart'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import {
  buildChannelDaily,
  buildWeekdayPattern,
  MIN_DAYS_FOR_MOVING_AVERAGE,
  withMovingAverage,
  type TrendPoint,
} from '@/domain/trends'
import { useBusinessContext } from '@/hooks/use-business-context'
import { formatDateShort, formatNumber, formatPLN, formatPLNCompact } from '@/lib/format'

const METRIC_OPTIONS = [
  { value: 'revenue' as const, label: 'Revenue' },
  { value: 'margin' as const, label: 'Profit' },
  { value: 'orders' as const, label: 'Orders' },
]

/** Short-history window: reacts within days while still smoothing weekday noise. */
const MA_WINDOW = 3

const METRIC_CONFIG: Record<
  TrendMetric,
  { key: keyof TrendPoint; maKey: keyof TrendPoint; colour: string; format: (v: number) => string }
> = {
  revenue: { key: 'revenuePLN', maKey: 'revenueMA', colour: 'var(--accent)', format: formatPLN },
  margin: { key: 'marginPLN', maKey: 'marginMA', colour: 'var(--positive)', format: formatPLN },
  orders: { key: 'orders', maKey: 'ordersMA', colour: 'var(--ink-muted)', format: formatNumber },
}

export function TrendsPage() {
  const { context, isLoading, isError, error, refetch } = useBusinessContext()
  const [metric, setMetric] = useState<TrendMetric>('revenue')
  const gradientId = useId()

  const enriched = useMemo(
    () => (context ? withMovingAverage(context.daily, MA_WINDOW) : []),
    [context],
  )
  const channelDaily = useMemo(
    () => (context ? buildChannelDaily(context.orders, context.daily) : []),
    [context],
  )
  const weekdays = useMemo(() => (context ? buildWeekdayPattern(context.daily) : []), [context])

  if (isLoading) return <PageSkeleton />
  if (isError || !context) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Trends" title="Trends" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const hasMA = context.daily.length >= MIN_DAYS_FOR_MOVING_AVERAGE
  const config = METRIC_CONFIG[metric]

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Trends"
        title="How the business moves"
        description={`${context.coverage.tradingDays} trading days on record. Seasonality and long-window averages unlock as history accumulates — nothing here extrapolates beyond the data.`}
        actions={
          <Segmented
            options={METRIC_OPTIONS}
            value={metric}
            onChange={setMetric}
            aria-label="Choose metric"
          />
        }
      />

      <section className="space-y-5">
        <SectionHeading
          title="Daily trend"
          description={
            hasMA
              ? `The dashed line is a ${MA_WINDOW}-day trailing average — the direction underneath the day-to-day noise. It starts on day ${MA_WINDOW} because an average of fewer days would be fiction.`
              : `A moving average appears once ${MIN_DAYS_FOR_MOVING_AVERAGE} days of history exist.`
          }
        />
        <Card>
          <CardContent className="p-6 pt-7">
            {enriched.length >= 3 ? (
              <ResponsiveContainer width="100%" height={300}>
                <ComposedChart data={enriched} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={config.colour} stopOpacity={0.16} />
                      <stop offset="100%" stopColor={config.colour} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => formatDateShort(value)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
                    dy={8}
                    minTickGap={24}
                  />
                  <YAxis
                    tickFormatter={(value: number) =>
                      metric === 'orders' ? formatNumber(value) : formatPLNCompact(value)
                    }
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
                    width={64}
                    allowDecimals={false}
                  />
                  <RechartsTooltip
                    cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const point = payload[0]?.payload as TrendPoint | undefined
                      if (!point) return null
                      const ma = point[config.maKey] as number | null
                      return (
                        <div className="min-w-[180px] rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                          <p className="mb-2 text-[12px] font-semibold text-ink">
                            {formatDateShort(String(label))}
                          </p>
                          <div className="flex items-baseline justify-between gap-6">
                            <span className="text-[12px] text-ink-muted">Actual</span>
                            <span className="tnum text-[12px] font-medium text-ink">
                              {config.format(Number(point[config.key]))}
                            </span>
                          </div>
                          {ma !== null && (
                            <div className="mt-1 flex items-baseline justify-between gap-6">
                              <span className="text-[12px] text-ink-muted">{MA_WINDOW}-day avg</span>
                              <span className="tnum text-[12px] font-medium text-ink">
                                {config.format(ma)}
                              </span>
                            </div>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Area
                    type="monotone"
                    dataKey={config.key as string}
                    stroke={config.colour}
                    strokeWidth={2}
                    fill={`url(#${gradientId})`}
                    dot={false}
                    activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
                    animationDuration={650}
                  />
                  {hasMA && (
                    <Line
                      type="monotone"
                      dataKey={config.maKey as string}
                      stroke="var(--ink-subtle)"
                      strokeWidth={1.5}
                      strokeDasharray="5 4"
                      dot={false}
                      connectNulls={false}
                      animationDuration={650}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Not enough trading history" />
            )}
          </CardContent>
        </Card>
      </section>

      <section className="grid grid-cols-1 items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader className="pb-5">
            <CardTitle>Revenue by marketplace</CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            {channelDaily.length >= 3 ? (
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={channelDaily} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
                  <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
                  <XAxis
                    dataKey="date"
                    tickFormatter={(value: string) => formatDateShort(value)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
                    dy={6}
                    minTickGap={20}
                  />
                  <YAxis
                    tickFormatter={(value: number) => formatPLNCompact(value)}
                    tickLine={false}
                    axisLine={false}
                    tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
                    width={58}
                  />
                  <RechartsTooltip
                    cursor={{ fill: 'var(--surface-sunken)' }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      return (
                        <div className="rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                          <p className="mb-2 text-[12px] font-semibold text-ink">
                            {formatDateShort(String(label))}
                          </p>
                          {payload.map((entry) => (
                            <div
                              key={String(entry.dataKey)}
                              className="flex items-baseline justify-between gap-6"
                            >
                              <span className="text-[12px] capitalize text-ink-muted">
                                {String(entry.dataKey)}
                              </span>
                              <span className="tnum text-[12px] font-medium text-ink">
                                {formatPLN(Number(entry.value))}
                              </span>
                            </div>
                          ))}
                        </div>
                      )
                    }}
                  />
                  <Bar dataKey="allegro" stackId="rev" fill="var(--accent)" />
                  <Bar dataKey="empik" stackId="rev" fill="var(--positive)" radius={[3, 3, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyState title="Not enough history" />
            )}
            <div className="mt-4 flex items-center gap-5 text-[12px] text-ink-muted">
              <LegendSwatch colour="var(--accent)" label="Allegro" />
              <LegendSwatch colour="var(--positive)" label="Empik" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-1">
            <CardTitle>Weekday rhythm</CardTitle>
            <p className="text-[12px] leading-relaxed text-ink-muted">
              Average revenue per occurrence of each weekday, so uneven date ranges compare fairly.
            </p>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3.5">
              {weekdays.map((day, index) => {
                const max = Math.max(...weekdays.map((d) => d.avgRevenuePLN), 1)
                return (
                  <li key={day.label} className="flex items-center gap-3">
                    <span className="w-9 shrink-0 text-[12px] font-medium text-ink-muted">
                      {day.label}
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                      <motion.div
                        className="h-full rounded-full bg-accent"
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(1, (day.avgRevenuePLN / max) * 100)}%` }}
                        transition={{ duration: 0.7, delay: 0.05 * index, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <span className="tnum w-20 shrink-0 text-right text-[12px] text-ink">
                      {formatPLN(day.avgRevenuePLN)}
                    </span>
                    <span className="tnum w-14 shrink-0 text-right text-[11px] text-ink-subtle">
                      {day.occurrences}×
                    </span>
                  </li>
                )
              })}
            </ul>
            {context.coverage.tradingDays < 14 && (
              <p className="mt-5 border-t border-hairline pt-4 text-[12px] text-ink-subtle">
                With under two weeks of history, each weekday has at most two observations — treat
                this as a sketch, not a pattern.
              </p>
            )}
          </CardContent>
        </Card>
      </section>
    </div>
  )
}

function LegendSwatch({ colour, label }: { colour: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="h-2.5 w-2.5 rounded-[3px]" style={{ backgroundColor: colour }} />
      {label}
    </span>
  )
}
