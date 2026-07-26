import { motion } from 'framer-motion'
import { AlertOctagon, AlertTriangle, ArrowRight, TrendingUp } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import type { Insight, InsightSeverity } from '@/domain/types'
import { formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

const SEVERITY: Record<
  InsightSeverity,
  { label: string; variant: 'negative' | 'caution' | 'accent'; rail: string }
> = {
  critical: { label: 'Critical', variant: 'negative', rail: 'bg-negative' },
  attention: { label: 'Needs attention', variant: 'caution', rail: 'bg-caution' },
  info: { label: 'Worth knowing', variant: 'accent', rail: 'bg-accent' },
}

/**
 * The unit of advice. Structure is fixed on purpose — finding, evidence, action
 * — so a founder learns to read it once and can then scan it forever.
 */
export function InsightCard({ insight, index = 0 }: { insight: Insight; index?: number }) {
  const severity = SEVERITY[insight.severity]
  const Icon =
    insight.kind === 'opportunity'
      ? TrendingUp
      : insight.severity === 'critical'
        ? AlertOctagon
        : AlertTriangle

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.06, ease: [0.16, 1, 0.3, 1] }}
      className="h-full"
    >
      <Card className="group relative h-full overflow-hidden hover:shadow-lifted">
        <span
          className={cn('absolute inset-y-0 left-0 w-[3px]', severity.rail)}
          aria-hidden="true"
        />

        <div className="flex h-full flex-col p-6 pl-7">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant={severity.variant} size="sm">
              <Icon className="h-3 w-3" aria-hidden="true" />
              {insight.kind === 'opportunity' ? 'Opportunity' : severity.label}
            </Badge>
            {insight.impactPLN !== null && (
              <Badge variant="outline" size="sm">
                <span className="tnum">{formatPLN(insight.impactPLN)}</span>
                <span className="text-ink-subtle">{insight.impactLabel}</span>
              </Badge>
            )}
          </div>

          <h3 className="mt-3.5 text-[15px] font-semibold leading-snug tracking-[-0.01em] text-ink">
            {insight.title}
          </h3>

          <p className="mt-2.5 text-[13px] leading-relaxed text-ink-muted">{insight.why}</p>

          <div className="mt-auto flex items-start gap-2.5 border-t border-hairline pt-4 [margin-top:1.25rem]">
            <ArrowRight
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5"
              aria-hidden="true"
            />
            <p className="text-[13px] leading-relaxed text-ink">{insight.action}</p>
          </div>
        </div>
      </Card>
    </motion.div>
  )
}
