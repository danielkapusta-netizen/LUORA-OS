import { motion } from 'framer-motion'
import { ArrowRight, Sparkles } from 'lucide-react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import type { ExecutiveBrief } from '@/domain/brief'
import { rise } from '@/lib/motion'

/**
 * The first thing read each day. Prose, not tiles — a founder should absorb the
 * state of the business in one pass without decoding a layout, then be handed
 * exactly one place to go next.
 */
export function ExecutiveBriefCard({
  brief,
  atStakePLN,
}: {
  brief: ExecutiveBrief
  atStakePLN: number | null
}) {
  return (
    <motion.div {...rise()}>
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 lg:grid-cols-[1.7fr_1fr]">
          <div className="p-8">
            <div className="flex items-center gap-2 text-ink-subtle">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <p className="t-label">
                Executive brief · {brief.scope}
              </p>
            </div>

            <p className="mt-4 text-[20px] font-medium leading-[1.45] tracking-[-0.02em] text-ink">
              {brief.greeting}. {brief.verdict}
            </p>

            <div className="mt-4 space-y-2">
              {brief.body.map((line, index) => (
                <motion.p
                  key={line}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.12 + index * 0.07 }}
                  className="t-body text-ink-muted"
                >
                  {line}
                </motion.p>
              ))}
            </div>
          </div>

          {brief.attentionCount > 0 && (
            <div className="flex flex-col justify-center gap-4 border-t border-hairline bg-surface-sunken/60 p-8 lg:border-l lg:border-t-0">
              <div>
                <p className="t-label text-ink-subtle">
                  Needs a decision
                </p>
                <p className="tnum mt-2 text-[28px] font-semibold leading-none tracking-[-0.03em] text-ink">
                  {brief.attentionCount}
                </p>
                <p className="mt-1.5 t-small text-ink-muted">
                  {atStakePLN !== null && atStakePLN > 0
                    ? `investigations open, worth roughly ${Math.round(atStakePLN).toLocaleString('en-GB')} zł in recoverable profit.`
                    : 'investigations open in the Action Centre.'}
                </p>
              </div>
              <Button asChild variant="primary" size="sm" className="w-fit">
                <Link to="/action-centre">
                  Open Action Centre
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
