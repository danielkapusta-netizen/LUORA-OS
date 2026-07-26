import { motion } from 'framer-motion'

import { channelName } from '@/domain/insights'
import type { ChannelPerformance } from '@/domain/types'
import { formatPercent, formatPLN } from '@/lib/format'

/**
 * Two channels do not need a chart library — they need a proportional bar and
 * an honest label. Revenue sets the bar width; margin rate is called out
 * separately because the wider bar is not always the better business.
 */
export function ChannelComparison({ channels }: { channels: readonly ChannelPerformance[] }) {
  const bestMargin = Math.max(...channels.map((channel) => channel.marginPct))

  return (
    <ul className="space-y-6">
      {channels.map((channel, index) => (
        <li key={channel.source} className="space-y-2.5">
          <div className="flex items-baseline justify-between gap-4">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[14px] font-medium text-ink">
                {channelName(channel.source)}
              </span>
              <span className="tnum text-[12px] text-ink-subtle">{channel.orders} orders</span>
            </div>
            <span className="tnum text-[14px] font-semibold text-ink">
              {formatPLN(channel.revenuePLN)}
            </span>
          </div>

          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
            <motion.div
              className="h-full rounded-full bg-accent"
              initial={{ width: 0 }}
              animate={{ width: `${Math.max(2, channel.revenueShare * 100)}%` }}
              transition={{ duration: 0.9, delay: 0.1 + index * 0.1, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>

          <div className="flex items-baseline justify-between gap-4 text-[12px]">
            <span className="text-ink-subtle">
              {formatPercent(channel.revenueShare * 100, 0)} of revenue
            </span>
            <span className="text-ink-muted">
              <span
                className={
                  channel.marginPct === bestMargin ? 'tnum font-medium text-positive' : 'tnum'
                }
              >
                {formatPercent(channel.marginPct)}
              </span>{' '}
              margin · {formatPLN(channel.avgOrderValuePLN)} avg order
            </span>
          </div>
        </li>
      ))}
    </ul>
  )
}
