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

import type { CatalogueTrendPoint } from '@/domain/catalogue'
import { formatNumber, formatPercent, formatPLN } from '@/lib/format'

function monthLabel(date: string): string {
  const parsed = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsed.getTime())) return date
  return parsed.toLocaleDateString('en-GB', { month: 'short', year: '2-digit', timeZone: 'UTC' })
}

/**
 * Margin rate over time for one catalogue row, with realised unit price behind
 * it on a second axis.
 *
 * The two belong on one chart because they explain each other: a margin line
 * falling while price holds points at cost, and both falling together points at
 * discounting. Read apart, either one invites the wrong conclusion.
 *
 * A reference line marks the portfolio average so "is this good" is answered by
 * position rather than arithmetic.
 */
export function MarginTrendChart({
  history,
  portfolioMarginPct,
  height = 200,
}: {
  history: readonly CatalogueTrendPoint[]
  portfolioMarginPct: number
  height?: number
}) {
  const gradientId = useId()
  if (history.length < 2) return null

  const margins = history.map((point) => point.marginPct)
  const lowest = Math.min(...margins, 0)

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={[...history]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
              <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="date"
            tickFormatter={monthLabel}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            dy={6}
            minTickGap={16}
          />
          <YAxis
            yAxisId="margin"
            tickFormatter={(value: number) => `${Math.round(value)}%`}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            width={46}
          />
          <YAxis
            yAxisId="price"
            orientation="right"
            tickFormatter={(value: number) => formatNumber(value)}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            width={44}
          />

          <Tooltip
            cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]?.payload as CatalogueTrendPoint | undefined
              if (!point) return null
              const rows = [
                { label: 'Margin', value: formatPercent(point.marginPct) },
                { label: 'Avg unit price', value: formatPLN(point.avgUnitPricePLN) },
                { label: 'Revenue', value: formatPLN(point.revenuePLN) },
                { label: 'Profit', value: formatPLN(point.marginPLN) },
                { label: 'Units', value: formatNumber(point.units) },
              ]
              return (
                <div className="min-w-[180px] rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                  <p className="mb-2 t-caption font-semibold text-ink">
                    {monthLabel(String(label))}
                  </p>
                  <dl className="space-y-1.5">
                    {rows.map((row) => (
                      <div key={row.label} className="flex items-baseline justify-between gap-6">
                        <dt className="t-caption text-ink-muted">{row.label}</dt>
                        <dd className="tnum t-caption font-medium text-ink">{row.value}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )
            }}
          />

          {/* Zero line only when the row actually went loss-making, so the
              chart does not imply a floor it never approached. */}
          {lowest < 0 && (
            <ReferenceLine yAxisId="margin" y={0} stroke="var(--negative)" strokeDasharray="3 3" />
          )}
          <ReferenceLine
            yAxisId="margin"
            y={portfolioMarginPct}
            stroke="var(--ink-subtle)"
            strokeDasharray="4 4"
            label={{
              value: 'Portfolio avg',
              position: 'insideTopLeft',
              fill: 'var(--ink-subtle)',
              fontSize: 10,
            }}
          />

          <Line
            yAxisId="price"
            type="monotone"
            dataKey="avgUnitPricePLN"
            stroke="var(--caution)"
            strokeWidth={1.5}
            strokeDasharray="3 3"
            dot={false}
            isAnimationActive={false}
          />
          <Area
            yAxisId="margin"
            type="monotone"
            dataKey="marginPct"
            stroke="var(--accent)"
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--accent)' }}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
            animationDuration={500}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
