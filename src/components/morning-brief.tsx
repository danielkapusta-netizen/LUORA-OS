import { motion } from 'framer-motion'
import { Sparkles, Target } from 'lucide-react'

import { Card } from '@/components/ui/card'
import type { MorningBrief as Brief } from '@/domain/brief'

/**
 * The first thing read each morning: the business in four sentences, then the
 * single thing worth doing about it. Prose, not tiles — a founder should be
 * able to absorb this without decoding a layout.
 */
export function MorningBriefCard({ brief }: { brief: Brief }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <Card className="overflow-hidden">
        <div className="grid grid-cols-1 gap-0 lg:grid-cols-[1.55fr_1fr]">
          <div className="p-8">
            <div className="flex items-center gap-2 text-ink-subtle">
              <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">
                Morning brief
              </p>
            </div>

            <p className="mt-4 text-[19px] font-medium leading-[1.5] tracking-[-0.02em] text-ink">
              {brief.headline}
            </p>

            <div className="mt-4 space-y-2.5">
              {brief.body.map((line, index) => (
                <motion.p
                  key={line}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4, delay: 0.15 + index * 0.08 }}
                  className="text-[14px] leading-relaxed text-ink-muted"
                >
                  {line}
                </motion.p>
              ))}
            </div>

            <p className="mt-6 text-[12px] text-ink-subtle">{brief.window}</p>
          </div>

          {brief.focus && (
            <div className="border-t border-hairline bg-surface-sunken/60 p-8 lg:border-l lg:border-t-0">
              <div className="flex items-center gap-2 text-ink-subtle">
                <Target className="h-3.5 w-3.5" aria-hidden="true" />
                <p className="text-[11px] font-semibold uppercase tracking-[0.08em]">Start here</p>
              </div>
              <p className="mt-4 text-[14px] leading-relaxed text-ink">{brief.focus}</p>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
