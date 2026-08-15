import { motion, useReducedMotion } from 'framer-motion'
import { useMemo } from 'react'

import { AnimatedNumber } from '@/components/animated-number'
import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import type { HealthBand, HealthScore } from '@/domain/types'
import { cn } from '@/lib/utils'

const BAND_COPY: Record<HealthBand, { label: string; variant: 'positive' | 'accent' | 'caution' | 'negative' }> = {
  strong: { label: 'Strong', variant: 'positive' },
  healthy: { label: 'Healthy', variant: 'accent' },
  watch: { label: 'Needs attention', variant: 'caution' },
  'at-risk': { label: 'At risk', variant: 'negative' },
}

const BAND_STROKE: Record<HealthBand, string> = {
  strong: 'var(--positive)',
  healthy: 'var(--accent)',
  watch: 'var(--caution)',
  'at-risk': 'var(--negative)',
}

const RADIUS = 62
const STROKE_WIDTH = 9
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/**
 * The one number the founder looks at first — and, immediately beneath it, the
 * five components that produced it. A score you cannot interrogate is a score
 * you cannot act on, so the breakdown is not hidden behind a click.
 */
export function HealthScoreCard({ health }: { health: HealthScore }) {
  const prefersReducedMotion = useReducedMotion()
  const band = BAND_COPY[health.band]
  const stroke = BAND_STROKE[health.band]

  const dashOffset = useMemo(
    () => CIRCUMFERENCE - (health.score / 100) * CIRCUMFERENCE,
    [health.score],
  )

  return (
    <Card className="h-full">
      <div className="flex h-full flex-col gap-7 p-7 lg:flex-row lg:items-start lg:gap-9">
        <div className="flex shrink-0 flex-col items-center gap-4">
          <div className="relative h-[148px] w-[148px]">
            <svg viewBox="0 0 148 148" className="h-full w-full -rotate-90">
              <circle
                cx="74"
                cy="74"
                r={RADIUS}
                fill="none"
                stroke="var(--hairline)"
                strokeWidth={STROKE_WIDTH}
              />
              <motion.circle
                cx="74"
                cy="74"
                r={RADIUS}
                fill="none"
                stroke={stroke}
                strokeWidth={STROKE_WIDTH}
                strokeLinecap="round"
                strokeDasharray={CIRCUMFERENCE}
                initial={{ strokeDashoffset: prefersReducedMotion ? dashOffset : CIRCUMFERENCE }}
                animate={{ strokeDashoffset: dashOffset }}
                transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1], delay: 0.15 }}
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-[38px] font-semibold leading-none tracking-[-0.035em] text-ink">
                <AnimatedNumber value={health.score} format={(value) => String(Math.round(value))} />
              </span>
              <span className="t-label mt-1 text-ink-subtle">
                out of 100
              </span>
            </div>
          </div>
          <Badge variant={band.variant} size="md">
            {band.label}
          </Badge>
        </div>

        <div className="flex min-w-0 flex-1 flex-col gap-6">
          <div className="space-y-2">
            <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">
              Business health
            </h2>
            <p className="t-body text-ink-muted">{health.headline}</p>
          </div>

          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {health.components.map((component, index) => (
              <motion.div
                key={component.key}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4, delay: 0.2 + index * 0.06, ease: [0.16, 1, 0.3, 1] }}
                className="space-y-2"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <Tooltip content={component.detail}>
                    <dt className="cursor-help t-caption font-medium text-ink-muted underline decoration-hairline-strong decoration-dotted underline-offset-4">
                      {component.label}
                    </dt>
                  </Tooltip>
                  <dd className="tnum shrink-0 t-caption font-medium text-ink">
                    {component.value}
                  </dd>
                </div>
                <ComponentBar score={component.score} delay={0.25 + index * 0.06} />
              </motion.div>
            ))}
          </dl>
        </div>
      </div>
    </Card>
  )
}

function ComponentBar({ score, delay }: { score: number; delay: number }) {
  const tone =
    score >= 75
      ? 'bg-positive'
      : score >= 50
        ? 'bg-accent'
        : score >= 30
          ? 'bg-caution'
          : 'bg-negative'

  return (
    <div className="h-1 w-full overflow-hidden rounded-full bg-surface-sunken">
      <motion.div
        className={cn('h-full rounded-full', tone)}
        initial={{ width: 0 }}
        animate={{ width: `${Math.max(2, score)}%` }}
        transition={{ duration: 0.8, delay, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}
