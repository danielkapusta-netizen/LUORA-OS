import { useId, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Scatter,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Segmented } from '@/components/ui/segmented'
import { buildMarginHistory, type PricePoint } from '@/domain/pricing'
import type { Granularity, LineItem } from '@/domain/types'
import { formatDateShort, formatPercent, formatPLNExact } from '@/lib/format'

const GRAIN_OPTIONS = [
  { value: 'day' as const, label: 'Daily' },
  { value: 'week' as const, label: 'Weekly' },
  { value: 'month' as const, label: 'Monthly' },
]

/**
 * Margin over time for one product, with the healthy line at 15% and zero
 * marked when losses occur. The question this chart answers is directional —
 * improving or deteriorating — so it carries no second series to dilute it.
 */
export function MarginTrendChart({ lines, height = 220 }: { lines: readonly LineItem[]; height?: number }) {
  const gradientId = useId()
  const [grain, setGrain] = useState<Granularity>('week')
  const history = buildMarginHistory(lines, grain)

  if (history.length < 2) {
    return (
      <p className="text-[13px] text-ink-subtle">
        Not enough history at this grain — try a coarser one.
      </p>
    )
  }

  const hasLoss = history.some((point) => point.marginPct < 0)

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Segmented options={GRAIN_OPTIONS} value={grain} onChange={setGrain} aria-label="Margin trend grain" />
      </div>
      <div style={{ height }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={history} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.16} />
                <stop offset="100%" stopColor="var(--accent)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
            <XAxis
              dataKey="date"
              tickFormatter={(value: string) => formatDateShort(value)}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
              dy={6}
              minTickGap={24}
            />
            <YAxis
              tickFormatter={(value: number) => `${Math.round(value)}%`}
              tickLine={false}
              axisLine={false}
              tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
              width={44}
            />
            <RechartsTooltip
              cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
              content={({ active, payload, label }) => {
                if (!active || !payload?.length) return null
                const point = payload[0]?.payload as (typeof history)[number] | undefined
                if (!point) return null
                return (
                  <div className="rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                    <p className="mb-1.5 text-[12px] font-semibold text-ink">
                      {formatDateShort(String(label))}
                    </p>
                    <p className="tnum text-[12px] text-ink-muted">
                      Margin <span className="font-medium text-ink">{formatPercent(point.marginPct)}</span>
                      {' · '}Profit{' '}
                      <span className="font-medium text-ink">{formatPLNExact(point.profitPLN)}</span>
                    </p>
                  </div>
                )
              }}
            />
            <ReferenceLine
              y={15}
              stroke="var(--positive)"
              strokeDasharray="4 4"
              label={{ value: 'Healthy 15%', position: 'insideTopRight', fill: 'var(--ink-subtle)', fontSize: 10 }}
            />
            {hasLoss && <ReferenceLine y={0} stroke="var(--negative)" strokeDasharray="3 3" />}
            <Area
              type="monotone"
              dataKey="marginPct"
              stroke="var(--accent)"
              strokeWidth={2}
              fill={`url(#${gradientId})`}
              dot={{ r: 2.5, strokeWidth: 0, fill: 'var(--accent)' }}
              activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
              animationDuration={450}
            />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

/**
 * Every realised unit price as a dot, with the running average behind it.
 * Discounting shows as dots dropping below the line; a manual price change
 * shows as the dots stepping to a new level. Volatility is visible as spread.
 */
export function PriceStabilityChart({
  points,
  averagePricePLN,
  height = 220,
}: {
  points: readonly PricePoint[]
  averagePricePLN: number
  height?: number
}) {
  if (points.length < 2) {
    return <p className="text-[13px] text-ink-subtle">Not enough sales to chart price behaviour.</p>
  }

  const data = points.map((point) => ({
    time: point.date.getTime(),
    price: point.unitPricePLN,
  }))

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid stroke="var(--chart-grid)" vertical={false} />
          <XAxis
            dataKey="time"
            type="number"
            domain={['dataMin', 'dataMax']}
            tickFormatter={(value: number) => formatDateShort(new Date(value))}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            dy={6}
            minTickGap={40}
          />
          <YAxis
            dataKey="price"
            tickFormatter={(value: number) => `${Math.round(value)}`}
            tickLine={false}
            axisLine={false}
            tick={{ fill: 'var(--ink-subtle)', fontSize: 11 }}
            width={40}
            domain={['auto', 'auto']}
          />
          <RechartsTooltip
            cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
            content={({ active, payload }) => {
              if (!active || !payload?.length) return null
              const point = payload[0]?.payload as { time: number; price: number } | undefined
              if (!point) return null
              return (
                <div className="rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
                  <p className="mb-1 text-[12px] font-semibold text-ink">
                    {formatDateShort(new Date(point.time))}
                  </p>
                  <p className="tnum text-[12px] text-ink-muted">
                    Sold at <span className="font-medium text-ink">{formatPLNExact(point.price)}</span>
                  </p>
                </div>
              )
            }}
          />
          <ReferenceLine
            y={averagePricePLN}
            stroke="var(--ink-subtle)"
            strokeDasharray="4 4"
            label={{ value: 'Average', position: 'insideTopRight', fill: 'var(--ink-subtle)', fontSize: 10 }}
          />
          <Line
            type="stepAfter"
            dataKey="price"
            stroke="var(--accent)"
            strokeWidth={1.25}
            strokeOpacity={0.5}
            dot={false}
            isAnimationActive={false}
          />
          <Scatter dataKey="price" fill="var(--accent)" />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  )
}
