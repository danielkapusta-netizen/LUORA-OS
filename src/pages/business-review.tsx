import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'
import { useMemo } from 'react'

import { Delta } from '@/components/delta'
import { PageHeader, SectionHeading } from '@/components/page-header'
import { ErrorState, PageSkeleton } from '@/components/states'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import { buildBusinessReview } from '@/domain/review'
import { useBusinessContext } from '@/hooks/use-business-context'
import { formatPercent, formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * The executive report: a written narrative first, the scorecard table after.
 * The narrative is generated from the same context as every other page, so it
 * can be pasted into an investor update without re-checking a single figure.
 */
export function BusinessReviewPage() {
  const { context, isLoading, isError, error, refetch } = useBusinessContext()

  const review = useMemo(() => (context ? buildBusinessReview(context) : null), [context])

  if (isLoading) return <PageSkeleton />
  if (isError || !context || !review) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Business Review" title="Business Review" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  return (
    <div className="space-y-12">
      <PageHeader
        eyebrow="Business Review"
        title="The state of Luora, written down"
        description={review.periodLabel}
      />

      <motion.section
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      >
        <Card>
          <CardContent className="max-w-3xl space-y-5 p-8">
            {review.narrative.map((paragraph, index) => (
              <motion.p
                key={paragraph.slice(0, 40)}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.4, delay: 0.1 + index * 0.08 }}
                className={cn(
                  'leading-relaxed',
                  index === 0
                    ? 'text-[17px] font-medium tracking-[-0.01em] text-ink'
                    : 'text-[14px] text-ink-muted',
                )}
              >
                {paragraph}
              </motion.p>
            ))}
          </CardContent>
        </Card>
      </motion.section>

      <section className="space-y-5">
        <SectionHeading
          title="Product scorecards"
          description={`Ranked by all-time revenue. ${review.productsFor80pct} products produce 80% of it — the running share column shows where that line falls. Window change compares the two most recent equal trading windows.`}
        />

        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left">
              <thead>
                <tr className="border-b border-hairline bg-surface-sunken/50 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
                  <th className="px-5 py-2.5 font-semibold">#</th>
                  <th className="px-3 py-2.5 font-semibold">Product</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Revenue</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Profit</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Margin</th>
                  <th className="px-3 py-2.5 text-right font-semibold">Window change</th>
                  <th className="px-5 py-2.5 text-right font-semibold">Running share</th>
                </tr>
              </thead>
              <tbody>
                {review.scorecards.map((card, index) => {
                  const { product } = card
                  const isThin = product.marginPct < 15
                  const insideCore = card.cumulativeShare <= 0.8 || index + 1 === review.productsFor80pct
                  return (
                    <tr
                      key={product.productKey}
                      className={cn(
                        'border-b border-hairline text-[13px] last:border-b-0',
                        index + 1 === review.productsFor80pct && 'border-b-2 border-hairline-strong',
                      )}
                    >
                      <td className="tnum px-5 py-3 text-ink-subtle">{index + 1}</td>
                      <td className="max-w-[320px] px-3 py-3">
                        <div className="flex items-center gap-2">
                          <span className="truncate font-medium text-ink" title={product.label}>
                            {product.label}
                          </span>
                          {product.costUnknown && (
                            <Tooltip content="No landed cost on file — profit shown excludes COGS.">
                              <AlertCircle
                                className="h-3.5 w-3.5 shrink-0 text-caution"
                                aria-label="Cost missing"
                              />
                            </Tooltip>
                          )}
                        </div>
                      </td>
                      <td className="tnum px-3 py-3 text-right text-ink">
                        {formatPLN(product.revenuePLN)}
                      </td>
                      <td className="tnum px-3 py-3 text-right text-ink">
                        {formatPLN(product.marginPLN)}
                      </td>
                      <td
                        className={cn(
                          'tnum px-3 py-3 text-right',
                          isThin ? 'font-medium text-negative' : 'text-ink-muted',
                        )}
                      >
                        {formatPercent(product.marginPct)}
                      </td>
                      <td className="px-3 py-3 text-right">
                        <Delta value={card.revenueChangePct} />
                      </td>
                      <td
                        className={cn(
                          'tnum px-5 py-3 text-right',
                          insideCore ? 'font-medium text-ink' : 'text-ink-subtle',
                        )}
                      >
                        {formatPercent(card.cumulativeShare * 100, 0)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </section>
    </div>
  )
}
