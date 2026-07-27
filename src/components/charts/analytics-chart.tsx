import { useId } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import {
  METRIC_DEFINITIONS,
  type AnalyticsPoint,
  type AnalyticsSeries,
  type OverlayKey,
} from '@/domain/analytics'
import { formatNumber, formatPercent, formatPLN, formatPLNCompact } from '@/lib/format'

const OVERLAY_STYLE: Record<
  Exclude<OverlayKey, 'forecast'>,
  { stroke: string; dash: string; label: string }
> = {
  previous: { stroke: 'var(--ink-subtle)', dash: '5 4', label: 'Previous period' },
  lastYear: { stroke: 'var(--caution)', dash: '2 3', label: 'Last year' },
  // Dotted, not solid: a solid line in a neighbouring shade of the primary
  // accent was indistinguishable from the actual series at a glance, so the
  // chart appeared to draw one line while the legend claimed two.
  movingAverage: { stroke: 'var(--ink)', dash: '1 4', label: 'Moving average' },
}

function bucketLabel(date: string, granularity: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  switch (granularity) {
    case 'year':
      return String(parsed.getUTCFullYear())
    case 'quarter':
      return `Q${Math.floor(parsed.getUTCMonth() / 3) + 1} ${String(parsed.getUTCFullYear()).slice(2)}`
    case 'month':
      return parsed.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    case 'week':
      return `w/c ${parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })}`
    default:
      return parsed.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' })
  }
}

/**
 * One metric, with every comparison drawn against it.
 *
 * The primary series is an area so the eye reads volume; every overlay is a
 * thin line so comparisons never compete with the actual. Forecast is rendered
 * as a separate dashed segment beyond a marker line, because a projection that
 * looks identical to measured trade invites someone to treat it as fact.
 */
export function AnalyticsChart({
  series,
  overlays,
  height = 320,
}: {
  series: AnalyticsSeries
  overlays: Record<OverlayKey, boolean>
  height?: number
}) {
  const gradientId = useId()
  const definition = METRIC_DEFINITIONS[series.metric]

  const format = (value: number) =>
    definition.format === 'pln'
      ? formatPLN(value)
      : definition.format === 'percent'
        ? formatPercent(value)
        : formatNumber(value)

  const axisFormat = (value: number) =>
    definition.format === 'pln'
      ? formatPLNCompact(value)
      : definition.format === 'percent'
        ? `${Math.round(value)}%`
        : formatNumber(value)

  const firstProjected = series.points.find((point) => point.isProjected)

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={series.points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.18} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={(value: string) => bucketLabel(value, series.granularity)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            dy={8}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={axisFormat}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            width={66}
          />

          <Tooltip
            cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]?.payload as AnalyticsPoint | undefined
              if (!point) return null

              const rows: Array<{ label: string; value: string; muted?: boolean }> = []
              if (point.value !== null) rows.push({ label: definition.label, value: format(point.value) })
              if (point.forecast !== null)
                rows.push({ label: 'Forecast', value: format(point.forecast), muted: true })
              if (overlays.previous && point.previous !== null)
                rows.push({ label: 'Previous period', value: format(point.previous), muted: true })
              if (overlays.lastYear && point.lastYear !== null)
                rows.push({ label: 'Last year', value: format(point.lastYear), muted: true })
              if (overlays.movingAverage && point.movingAverage !== null)
                rows.push({ label: 'Moving average', value: format(point.movingAverage), muted: true })

              return (
                <div className="min-w-[200px] rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                  <p className="mb-2 text-[12px] font-semibold text-ink">
                    {bucketLabel(String(label), series.granularity)}
                    {point.isProjected && (
                      <span className="ml-1.5 font-normal text-ink-subtle">· projected</span>
                    )}
                  </p>
                  <dl className="space-y-1.5">
                    {rows.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-6">
                        <dt className="text-[12px] text-ink-muted">{row.label}</dt>
                        <dd
                          className={`tnum text-[12px] font-medium ${row.muted ? 'text-ink-muted' : 'text-ink'}`}
                        >
                          {row.value}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            }}
          />

          {/* Overlays sit beneath the primary series so they never obscure it. */}
          {overlays.previous && series.available.previous && (
            <Line
              type="monotone"
              dataKey="previous"
              stroke={OVERLAY_STYLE.previous.stroke}
              strokeWidth={1.5}
              strokeDasharray={OVERLAY_STYLE.previous.dash}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}
          {overlays.lastYear && series.available.lastYear && (
            <Line
              type="monotone"
              dataKey="lastYear"
              stroke={OVERLAY_STYLE.lastYear.stroke}
              strokeWidth={1.5}
              strokeDasharray={OVERLAY_STYLE.lastYear.dash}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          <Area
            type="monotone"
            dataKey="value"
            stroke="var(--accent)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
            animationDuration={600}
            connectNulls={false}
          />

          {overlays.movingAverage && series.available.movingAverage && (
            <Line
              type="monotone"
              dataKey="movingAverage"
              stroke={OVERLAY_STYLE.movingAverage.stroke}
              strokeWidth={1.75}
              strokeDasharray={OVERLAY_STYLE.movingAverage.dash}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          )}

          {overlays.forecast && series.available.forecast && (
            <>
              {firstProjected && (
                <ReferenceLine
                  x={firstProjected.date}
                  stroke="var(--hairline-strong)"
                  strokeDasharray="3 3"
                />
              )}
              <Line
                type="monotone"
                dataKey="forecast"
                stroke="var(--positive)"
                strokeWidth={2}
                strokeDasharray="6 4"
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </>
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Legend describing whichever overlays are currently drawn. */
export function ChartLegend({
  overlays,
  available,
}: {
  overlays: Record<OverlayKey, boolean>
  available: Record<OverlayKey, boolean>
}) {
  const entries: Array<{ key: OverlayKey; colour: string; label: string; dashed: boolean }> = [
    { key: 'previous', colour: OVERLAY_STYLE.previous.stroke, label: 'Previous period', dashed: true },
    { key: 'lastYear', colour: OVERLAY_STYLE.lastYear.stroke, label: 'Last year', dashed: true },
    {
      key: 'movingAverage',
      colour: OVERLAY_STYLE.movingAverage.stroke,
      label: 'Moving average',
      dashed: true,
    },
    { key: 'forecast', colour: 'var(--positive)', label: 'Forecast', dashed: true },
  ]

  const visible = entries.filter((entry) => overlays[entry.key] && available[entry.key])
  if (visible.length === 0) return null

  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 text-[12px] text-ink-muted">
      <span className="flex items-center gap-1.5">
        <span className="h-0.5 w-4 rounded-full bg-accent" />
        Actual
      </span>
      {visible.map((entry) => (
        <span key={entry.key} className="flex items-center gap-1.5">
          <span
            className="h-0.5 w-4 rounded-full"
            style={{
              backgroundColor: entry.dashed ? 'transparent' : entry.colour,
              backgroundImage: entry.dashed
                ? `repeating-linear-gradient(to right, ${entry.colour} 0 4px, transparent 4px 7px)`
                : undefined,
            }}
          />
          {entry.label}
        </span>
      ))}
    </div>
  )
}
