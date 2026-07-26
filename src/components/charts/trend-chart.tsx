import { useId } from 'react'
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import type { DailyPoint } from '@/domain/types'
import { formatDateShort, formatNumber, formatPercent, formatPLN, formatPLNCompact } from '@/lib/format'

export type TrendMetric = 'revenue' | 'margin' | 'orders'

const METRIC_CONFIG: Record<
  TrendMetric,
  { key: keyof DailyPoint; label: string; colour: string; format: (value: number) => string }
> = {
  revenue: { key: 'revenuePLN', label: 'Revenue', colour: 'var(--accent)', format: formatPLN },
  margin: { key: 'marginPLN', label: 'Profit', colour: 'var(--positive)', format: formatPLN },
  orders: { key: 'orders', label: 'Orders', colour: 'var(--ink-muted)', format: formatNumber },
}

interface TooltipEntry {
  payload?: DailyPoint
}

/**
 * The hover card always shows the full day — revenue, profit, margin rate and
 * orders — regardless of which series is plotted. Switching metrics to read a
 * second number would be a wasted interaction.
 */
function TrendTooltip({ active, payload }: { active?: boolean; payload?: TooltipEntry[] }) {
  const point = payload?.[0]?.payload
  if (!active || !point) return null

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Revenue', value: formatPLN(point.revenuePLN) },
    { label: 'Profit', value: formatPLN(point.marginPLN) },
    { label: 'Margin', value: formatPercent(point.marginPct) },
    { label: 'Orders', value: formatNumber(point.orders) },
  ]

  return (
    <div className="min-w-[190px] rounded-xl border border-hairline bg-surface-raised p-3 shadow-overlay">
      <p className="mb-2.5 text-[12px] font-semibold text-ink">{formatDateShort(point.date)}</p>
      <dl className="space-y-1.5">
        {rows.map((row) => (
          <div key={row.label} className="flex items-baseline justify-between gap-6">
            <dt className="text-[12px] text-ink-muted">{row.label}</dt>
            <dd className="tnum text-[12px] font-medium text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function TrendChart({
  data,
  metric,
  height = 280,
}: {
  data: readonly DailyPoint[]
  metric: TrendMetric
  height?: number
}) {
  const gradientId = useId()
  const config = METRIC_CONFIG[metric]

  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={[...data]} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={config.colour} stopOpacity={0.16} />
              <stop offset="100%" stopColor={config.colour} stopOpacity={0} />
            </linearGradient>
          </defs>

          <CartesianGrid
            stroke="var(--chart-grid)"
            strokeDasharray="0"
            vertical={false}
          />
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
          <Tooltip
            content={<TrendTooltip />}
            cursor={{ stroke: 'var(--hairline-strong)', strokeWidth: 1 }}
          />
          <Area
            type="monotone"
            dataKey={config.key as string}
            name={config.label}
            stroke={config.colour}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 2, stroke: 'var(--surface)' }}
            animationDuration={650}
            animationEasing="ease-out"
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
