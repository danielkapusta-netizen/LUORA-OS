import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'

import { Tooltip } from '@/components/ui/tooltip'
import { shortLabel } from '@/domain/sku'
import type { ProductPerformance } from '@/domain/types'
import { formatPercent, formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

export type LeaderboardMetric = 'revenue' | 'margin'

/**
 * Ranked contribution, not a bar chart. The bar is scaled to the leader so the
 * eye reads relative weight instantly, and the margin rate sits alongside so a
 * high-revenue, low-profit product cannot masquerade as a winner.
 */
export function ProductLeaderboard({
  products,
  metric,
  limit = 6,
}: {
  products: readonly ProductPerformance[]
  metric: LeaderboardMetric
  limit?: number
}) {
  const ranked = [...products]
    .sort((a, b) =>
      metric === 'revenue' ? b.revenuePLN - a.revenuePLN : b.marginPLN - a.marginPLN,
    )
    .slice(0, limit)

  const leaderValue = ranked[0]
    ? metric === 'revenue'
      ? ranked[0].revenuePLN
      : ranked[0].marginPLN
    : 0

  return (
    <ol className="space-y-5">
      {ranked.map((product, index) => {
        const value = metric === 'revenue' ? product.revenuePLN : product.marginPLN
        const width = leaderValue > 0 ? Math.max(1.5, (value / leaderValue) * 100) : 0
        const isThin = product.marginPct < 15

        return (
          <li key={product.productKey} className="group space-y-2">
            <div className="flex items-baseline justify-between gap-4">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <span className="tnum w-4 shrink-0 text-[12px] font-medium text-ink-subtle">
                  {index + 1}
                </span>
                {/* min-w-0 on the flex item itself: without it the nowrap
                    text sets a min-content floor and overflows narrow grids. */}
                <span
                  className="min-w-0 truncate text-[13px] font-medium text-ink"
                  title={product.label}
                >
                  {shortLabel(product.label, 52)}
                </span>
                {product.costUnknown && (
                  <Tooltip content="No landed cost on file for this product, so its profit is reported without COGS and is overstated.">
                    <AlertCircle
                      className="h-3.5 w-3.5 shrink-0 text-caution"
                      aria-label="Cost data missing"
                    />
                  </Tooltip>
                )}
              </div>
              <span className="tnum shrink-0 text-[13px] font-semibold text-ink">
                {formatPLN(value)}
              </span>
            </div>

            <div className="flex items-center gap-3 pl-[26px]">
              <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-sunken">
                <motion.div
                  className={cn(
                    'h-full rounded-full',
                    metric === 'revenue' ? 'bg-accent' : 'bg-positive',
                  )}
                  initial={{ width: 0 }}
                  animate={{ width: `${width}%` }}
                  transition={{ duration: 0.8, delay: 0.08 * index, ease: [0.16, 1, 0.3, 1] }}
                />
              </div>
              <span
                className={cn(
                  'tnum w-[86px] shrink-0 text-right text-[12px]',
                  isThin ? 'text-negative' : 'text-ink-muted',
                )}
              >
                {formatPercent(product.marginPct)} margin
              </span>
              <span className="tnum w-[62px] shrink-0 text-right text-[12px] text-ink-subtle">
                {product.orders} {product.orders === 1 ? 'order' : 'orders'}
              </span>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
