import { useId } from 'react'
import { Area, AreaChart, ResponsiveContainer } from 'recharts'

/**
 * Shape-only trend line for metric cards. Deliberately axis-free: it answers
 * "which way has this been going", never "what was Tuesday".
 */
export function Sparkline({
  data,
  tone = 'accent',
  height = 44,
}: {
  data: readonly number[]
  tone?: 'accent' | 'positive' | 'neutral'
  height?: number
}) {
  const gradientId = useId()
  const stroke =
    tone === 'positive' ? 'var(--positive)' : tone === 'neutral' ? 'var(--ink-subtle)' : 'var(--accent)'

  if (data.length < 2) return null

  const points = data.map((value, index) => ({ index, value }))

  return (
    <div style={{ height }} aria-hidden="true">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={points} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Area
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={1.75}
            fill={`url(#${gradientId})`}
            isAnimationActive={false}
            dot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}
