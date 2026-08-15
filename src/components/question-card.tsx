import { motion } from 'framer-motion'
import { ArrowRight, HelpCircle } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Card } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import type { QuestionAnswer, QuestionTone } from '@/domain/questions'
import type { Confidence } from '@/domain/types'
import { cn } from '@/lib/utils'
import { rise } from '@/lib/motion'

const TONE_STYLE: Record<QuestionTone, { metric: string; rail: string }> = {
  positive: { metric: 'text-positive', rail: 'bg-positive' },
  negative: { metric: 'text-negative', rail: 'bg-negative' },
  opportunity: { metric: 'text-accent', rail: 'bg-accent' },
  neutral: { metric: 'text-ink', rail: 'bg-ink-subtle' },
}

const CONFIDENCE_COPY: Record<Confidence, string> = {
  high: 'Backed by a large enough sample to act on directly.',
  medium: 'Enough orders to be indicative; confirm before a large commitment.',
  low: 'Few orders behind this — treat as a signal to watch, not a mandate.',
}

/**
 * One founder question, answered. The question is the heading because that is
 * how the answer gets found — scanning for the question you happen to be
 * asking beats scanning for a metric whose name you must first guess.
 */
export function QuestionCard({
  answer,
  index = 0,
}: {
  answer: QuestionAnswer
  index?: number
}) {
  const tone = TONE_STYLE[answer.tone]

  return (
    <motion.div {...rise(index)}
      className="h-full"
    >
      <Card className="group relative h-full overflow-hidden hover:shadow-lifted">
        <span className={cn('absolute inset-y-0 left-0 w-[3px]', tone.rail)} aria-hidden="true" />

        <div className="flex h-full flex-col p-6 pl-7">
          <div className="flex items-start gap-2">
            <HelpCircle
              className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle"
              aria-hidden="true"
            />
            <h3 className="t-small font-medium text-ink-muted">
              {answer.question}
            </h3>
          </div>

          <p className="mt-4 t-strong text-ink">
            {answer.headline}
          </p>

          <div className="mt-3 flex items-baseline gap-2.5">
            <span className={cn('tnum text-[24px] font-semibold tracking-[-0.03em]', tone.metric)}>
              {answer.metric}
            </span>
            <span className="t-caption text-ink-subtle">
              {answer.metricCaption}
            </span>
          </div>

          <p className="mt-3.5 t-small text-ink-muted">{answer.explanation}</p>

          {answer.recommendation && (
            <div className="mt-auto flex items-start gap-2.5 border-t border-hairline pt-4 [margin-top:1.25rem]">
              <ArrowRight
                className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ink-subtle transition-transform duration-200 group-hover:translate-x-0.5"
                aria-hidden="true"
              />
              <p className="t-small text-ink">{answer.recommendation}</p>
            </div>
          )}

          {answer.confidence && (
            <div className="mt-3">
              <Tooltip content={CONFIDENCE_COPY[answer.confidence]}>
                <span className="inline-flex cursor-help">
                  <Badge
                    variant={
                      answer.confidence === 'high'
                        ? 'positive'
                        : answer.confidence === 'medium'
                          ? 'neutral'
                          : 'caution'
                    }
                    size="sm"
                  >
                    {answer.confidence} confidence
                  </Badge>
                </span>
              </Tooltip>
            </div>
          )}
        </div>
      </Card>
    </motion.div>
  )
}
