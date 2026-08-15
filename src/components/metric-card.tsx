import { motion } from 'framer-motion'
import { Info } from 'lucide-react'
import type { ReactNode } from 'react'

import { AnimatedNumber } from '@/components/animated-number'
import { Sparkline } from '@/components/charts/sparkline'
import { Delta } from '@/components/delta'
import { Card } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { rise } from '@/lib/motion'

export interface MetricCardProps {
  label: string
  value: number
  format: (value: number) => string
  delta?: number | null
  /** Percentage points for rates, percent for absolute figures. */
  deltaUnit?: 'percent' | 'pp'
  /** What the delta is measured against, e.g. "vs previous 5 days". */
  deltaCaption?: string
  /** Explains how the figure is derived. Precision builds trust. */
  hint?: string
  spark?: readonly number[]
  sparkTone?: 'accent' | 'positive' | 'neutral'
  footer?: ReactNode
  index?: number
}

/**
 * The atom of the executive summary: one number, its direction, and the
 * evidence behind it. Never two numbers competing for the same glance.
 */
export function MetricCard({
  label,
  value,
  format,
  delta,
  deltaUnit = 'percent',
  deltaCaption,
  hint,
  spark,
  sparkTone = 'accent',
  footer,
  index = 0,
}: MetricCardProps) {
  return (
    <motion.div {...rise(index)}>
      <Card className="group h-full overflow-hidden hover:shadow-lifted">
        <div className="flex h-full flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            <p className="t-label text-ink-subtle">
              {label}
            </p>
            {hint && (
              <Tooltip content={hint}>
                <button
                  type="button"
                  aria-label={`How ${label} is calculated`}
                  className="text-ink-subtle opacity-0 transition-opacity duration-200 hover:text-ink-muted focus-visible:opacity-100 group-hover:opacity-100"
                >
                  <Info className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
            )}
          </div>

          <p className="mt-3 text-[30px] font-semibold leading-none tracking-[-0.03em] text-ink">
            <AnimatedNumber value={value} format={format} />
          </p>

          {(delta !== undefined || deltaCaption) && (
            <div className="mt-4 flex flex-wrap items-center gap-x-2 gap-y-1">
              {delta !== undefined && <Delta value={delta ?? null} unit={deltaUnit} />}
              {deltaCaption && <span className="t-caption text-ink-subtle">{deltaCaption}</span>}
            </div>
          )}

          {spark && spark.length > 1 && (
            <div className={cn('-mx-1 mt-5', footer ? 'mb-4' : 'mt-auto pt-5')}>
              <Sparkline data={spark} tone={sparkTone} />
            </div>
          )}

          {footer && <div className="mt-auto pt-4 t-caption text-ink-muted">{footer}</div>}
        </div>
      </Card>
    </motion.div>
  )
}
