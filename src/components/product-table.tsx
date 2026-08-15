import { motion } from 'framer-motion'
import { AlertCircle } from 'lucide-react'

import { Tooltip } from '@/components/ui/tooltip'
import { shortLabel } from '@/domain/sku'
import type { ProductPerformance } from '@/domain/types'
import { formatNumber, formatPercent, formatPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

export type ProductTableMetric = 'revenue' | 'margin'

/**
 * The product detail a founder wants without leaving the homepage.
 *
 * Deliberately a table rather than the ranked bars used elsewhere: bars answer
 * "which is biggest", but the question here is "how is each one doing", which
 * needs orders, units, both money columns and the rate side by side. The bar
 * survives inside the revenue column so relative weight is still readable at a
 * glance.
 */
export function ProductTable({
  products,
  metric,
  limit = 8,
}: {
  products: readonly ProductPerformance[]
  metric: ProductTableMetric
  limit?: number
}) {
  const ranked = [...products]
    .sort((a, b) => (metric === 'revenue' ? b.revenuePLN - a.revenuePLN : b.marginPLN - a.marginPLN))
    .slice(0, limit)

  if (ranked.length === 0) return null

  const peak = Math.max(
    ...ranked.map((product) => (metric === 'revenue' ? product.revenuePLN : product.marginPLN)),
    1,
  )

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[700px] text-left">
        <thead>
          <tr className="t-label text-ink-subtle">
            <th className="px-5 py-2.5 font-semibold">#</th>
            <th className="py-2.5 font-semibold">Product</th>
            <th className="px-3 py-2.5 text-right font-semibold">Orders</th>
            <th className="px-3 py-2.5 text-right font-semibold">Units</th>
            <th className="px-3 py-2.5 font-semibold">
              {metric === 'revenue' ? 'Revenue' : 'Profit'}
            </th>
            <th className="px-3 py-2.5 text-right font-semibold">
              {metric === 'revenue' ? 'Profit' : 'Revenue'}
            </th>
            <th className="px-3 py-2.5 text-right font-semibold">Margin</th>
            <th className="px-5 py-2.5 text-right font-semibold">Share</th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((product, index) => {
            const primary = metric === 'revenue' ? product.revenuePLN : product.marginPLN
            const secondary = metric === 'revenue' ? product.marginPLN : product.revenuePLN
            const share = metric === 'revenue' ? product.revenueShare : product.marginShare
            const isThin = product.marginPct < 15

            return (
              <motion.tr
                key={product.productKey}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.3, delay: index * 0.03 }}
                className="border-t border-hairline t-small"
              >
                <td className="tnum px-5 py-3 text-ink-subtle">{index + 1}</td>
                <td className="max-w-[260px] py-3">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-medium text-ink" title={product.label}>
                      {shortLabel(product.label, 46)}
                    </span>
                    {product.costUnknown && (
                      <Tooltip content="No landed cost on file — this product's profit is overstated.">
                        <AlertCircle
                          className="h-3.5 w-3.5 shrink-0 text-caution"
                          aria-label="Cost missing"
                        />
                      </Tooltip>
                    )}
                  </div>
                </td>
                <td className="tnum px-3 py-3 text-right text-ink-muted">
                  {formatNumber(product.orders)}
                </td>
                <td className="tnum px-3 py-3 text-right text-ink-muted">
                  {formatNumber(product.units)}
                </td>
                <td className="px-3 py-3">
                  <div className="flex items-center gap-2.5">
                    <div className="h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-surface-sunken">
                      <motion.div
                        className={cn(
                          'h-full rounded-full',
                          metric === 'revenue' ? 'bg-accent' : 'bg-positive',
                        )}
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.max(2, (primary / peak) * 100)}%` }}
                        transition={{ duration: 0.7, delay: index * 0.04, ease: [0.16, 1, 0.3, 1] }}
                      />
                    </div>
                    <span className="tnum font-medium text-ink">{formatPLN(primary)}</span>
                  </div>
                </td>
                <td
                  className={cn(
                    'tnum px-3 py-3 text-right',
                    secondary < 0 ? 'font-medium text-negative' : 'text-ink-muted',
                  )}
                >
                  {formatPLN(secondary)}
                </td>
                <td
                  className={cn(
                    'tnum px-3 py-3 text-right',
                    isThin ? 'font-medium text-negative' : 'text-ink-muted',
                  )}
                >
                  {formatPercent(product.marginPct)}
                </td>
                <td className="tnum px-5 py-3 text-right text-ink-subtle">
                  {formatPercent(share * 100, 0)}
                </td>
              </motion.tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
