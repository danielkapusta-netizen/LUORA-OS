import { Clock, RefreshCw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Tooltip } from '@/components/ui/tooltip'
import type { DataCoverage } from '@/domain/types'
import { formatDate, formatFreshness } from '@/lib/format'
import { cn } from '@/lib/utils'

/**
 * Anchors every figure on the page to the last order Luora actually has.
 *
 * A briefing tool that implies "today" while reading nine-day-old data is worse
 * than no briefing at all, so the edge of the data is stated in the header
 * rather than buried in a footnote.
 */
export function DataFreshness({
  coverage,
  isFetching,
  onRefresh,
}: {
  coverage: DataCoverage
  isFetching: boolean
  onRefresh: () => void
}) {
  const staleDays = coverage.lastOrder
    ? Math.floor((Date.now() - coverage.lastOrder.getTime()) / 86_400_000)
    : null
  const isStale = staleDays !== null && staleDays >= 2

  return (
    <div className="flex items-center gap-2">
      <Tooltip
        content={`Every figure on this page is calculated from orders up to ${formatDate(coverage.lastOrder)}. Nothing here assumes today's trading.`}
      >
        <div
          className={cn(
            'flex cursor-help items-center gap-2 rounded-control border px-3 py-1.5 t-caption',
            isStale
              ? 'border-caution/30 bg-caution-soft text-caution'
              : 'border-hairline bg-surface text-ink-muted',
          )}
        >
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          <span>
            Data through {formatDate(coverage.lastOrder)}
            {isStale && ` · ${formatFreshness(coverage.lastOrder)}`}
          </span>
        </div>
      </Tooltip>

      <Button
        variant="secondary"
        size="icon"
        onClick={onRefresh}
        disabled={isFetching}
        aria-label="Refresh data"
      >
        <RefreshCw className={cn('h-3.5 w-3.5', isFetching && 'animate-spin')} aria-hidden="true" />
      </Button>
    </div>
  )
}
