import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { formatSignedPercent } from '@/lib/format'

/**
 * A change indicator that knows the difference between "flat" and "unknown".
 * A null delta renders as an explicit dash rather than a misleading 0%.
 */
export function Delta({
  value,
  /** Set false where a rise is bad news, e.g. cost or refund rates. */
  higherIsBetter = true,
  size = 'sm',
  /**
   * A rate that moves from 30% to 33% has risen 3 percentage points, not 3
   * percent. Conflating the two is the most common way a dashboard lies.
   */
  unit = 'percent',
}: {
  value: number | null
  higherIsBetter?: boolean
  size?: 'sm' | 'md'
  unit?: 'percent' | 'pp'
}) {
  if (value === null || !Number.isFinite(value)) {
    return (
      <Badge variant="neutral" size={size}>
        <Minus className="h-3 w-3" aria-hidden="true" />
        No baseline
      </Badge>
    )
  }

  const isFlat = Math.abs(value) < 0.05
  const isGood = higherIsBetter ? value > 0 : value < 0
  const variant = isFlat ? 'neutral' : isGood ? 'positive' : 'negative'
  const Icon = isFlat ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight

  return (
    <Badge variant={variant} size={size}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      <span className="tnum">
        {isFlat
          ? 'Flat'
          : unit === 'pp'
            ? `${value > 0 ? '+' : ''}${value.toFixed(1)}pp`
            : formatSignedPercent(value)}
      </span>
    </Badge>
  )
}
