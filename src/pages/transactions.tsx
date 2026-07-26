import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Search } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/page-header'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { channelName } from '@/domain/insights'
import type { Order } from '@/domain/types'
import { useBusinessContext } from '@/hooks/use-business-context'
import {
  formatDate,
  formatNumber,
  formatPercent,
  formatPLN,
  formatPLNExact,
} from '@/lib/format'
import { cn } from '@/lib/utils'

type ChannelFilter = 'all' | 'allegro' | 'empik'
type MarginFilter = 'all' | 'healthy' | 'thin'

const CHANNEL_OPTIONS = [
  { value: 'all' as const, label: 'All channels' },
  { value: 'allegro' as const, label: 'Allegro' },
  { value: 'empik' as const, label: 'Empik' },
]

const MARGIN_OPTIONS = [
  { value: 'all' as const, label: 'Any margin' },
  { value: 'healthy' as const, label: '≥ 15%' },
  { value: 'thin' as const, label: '< 15%' },
]

const PAGE_SIZE = 25

/**
 * The explorer is the one place the summary views' simplifications are undone:
 * original currencies, commission, and per-order margin are all visible here.
 * Newest orders first — that is what a founder checks the explorer for.
 */
export function TransactionsPage() {
  const { context, isLoading, isError, error, refetch } = useBusinessContext()
  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [marginBand, setMarginBand] = useState<MarginFilter>('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    if (!context) return []
    const query = search.trim().toLowerCase()
    return context.orders
      .filter((order) => {
        if (channel !== 'all' && order.source !== channel) return false
        if (marginBand === 'healthy' && !(order.marginPct !== null && order.marginPct >= 15))
          return false
        if (marginBand === 'thin' && !(order.marginPct !== null && order.marginPct < 15))
          return false
        if (
          query &&
          !order.productLabel.toLowerCase().includes(query) &&
          !order.customerName.toLowerCase().includes(query)
        )
          return false
        return true
      })
      .sort((a, b) => (b.date?.getTime() ?? 0) - (a.date?.getTime() ?? 0))
  }, [context, channel, marginBand, search])

  if (isLoading) return <PageSkeleton />
  if (isError || !context) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Transactions" title="Transactions" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const visible = filtered.slice(0, visibleCount)
  const filteredRevenue = filtered.reduce((total, order) => total + order.revenuePLN, 0)
  const filteredMargin = filtered.reduce((total, order) => total + order.marginPLN, 0)

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Transactions"
        title="Every order, explorable"
        description={
          <>
            {formatNumber(filtered.length)} of {formatNumber(context.orders.length)} orders shown —{' '}
            <span className="tnum font-medium text-ink">{formatPLN(filteredRevenue)}</span> revenue,{' '}
            <span className="tnum font-medium text-ink">{formatPLN(filteredMargin)}</span> profit in
            this view.
          </>
        }
      />

      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <label className="relative block max-w-sm flex-1">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-subtle"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setVisibleCount(PAGE_SIZE)
            }}
            placeholder="Search product or customer…"
            className="h-9 w-full rounded-control border border-hairline bg-surface pl-9 pr-3 text-[13px] text-ink placeholder:text-ink-subtle"
          />
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented
            options={CHANNEL_OPTIONS}
            value={channel}
            onChange={(value) => {
              setChannel(value)
              setVisibleCount(PAGE_SIZE)
            }}
            aria-label="Filter by channel"
          />
          <Segmented
            options={MARGIN_OPTIONS}
            value={marginBand}
            onChange={(value) => {
              setMarginBand(value)
              setVisibleCount(PAGE_SIZE)
            }}
            aria-label="Filter by margin band"
          />
        </div>
      </div>

      {visible.length === 0 ? (
        <Card>
          <EmptyState
            title="No orders match these filters"
            description="Loosen the search or margin filter to bring orders back."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          {/* Column header — desktop only; rows carry their own labels on mobile. */}
          <div className="hidden border-b border-hairline bg-surface-sunken/50 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle sm:grid sm:grid-cols-[110px_1fr_90px_110px_110px_90px_28px] sm:gap-4">
            <span>Date</span>
            <span>Product</span>
            <span>Channel</span>
            <span className="text-right">Total</span>
            <span className="text-right">Profit (PLN)</span>
            <span className="text-right">Margin</span>
            <span />
          </div>

          <ul>
            {visible.map((order) => (
              <OrderRow
                key={order.id}
                order={order}
                isOpen={openId === order.id}
                onToggle={() => setOpenId(openId === order.id ? null : order.id)}
              />
            ))}
          </ul>

          {filtered.length > visibleCount && (
            <div className="flex justify-center border-t border-hairline p-4">
              <Button variant="secondary" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
                Show {Math.min(PAGE_SIZE, filtered.length - visibleCount)} more
              </Button>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function OrderRow({
  order,
  isOpen,
  onToggle,
}: {
  order: Order
  isOpen: boolean
  onToggle: () => void
}) {
  const isThin = order.marginPct !== null && order.marginPct < 15

  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'grid w-full grid-cols-[1fr_28px] items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-sunken/50',
          'sm:grid-cols-[110px_1fr_90px_110px_110px_90px_28px] sm:gap-4',
          isOpen && 'bg-surface-sunken/50',
        )}
      >
        <span className="hidden text-[12px] text-ink-muted sm:block">
          {order.date ? formatDate(order.date) : '—'}
        </span>

        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink" title={order.rawSku}>
            {order.productLabel}
          </span>
          <span className="mt-0.5 block text-[11px] text-ink-subtle sm:hidden">
            {order.date ? formatDate(order.date) : 'No date'} · {channelName(order.source)} ·{' '}
            {formatPLN(order.revenuePLN)}
          </span>
        </span>

        <span className="hidden sm:block">
          <Badge variant="neutral" size="sm">
            {channelName(order.source)}
          </Badge>
        </span>

        <span className="tnum hidden text-right text-[13px] text-ink sm:block">
          {formatPLNExact(order.revenuePLN)}
        </span>
        <span className="tnum hidden text-right text-[13px] font-medium text-ink sm:block">
          {order.isComplete ? formatPLNExact(order.marginPLN) : '—'}
        </span>
        <span
          className={cn(
            'tnum hidden text-right text-[13px] sm:block',
            isThin ? 'font-medium text-negative' : 'text-ink-muted',
          )}
        >
          {formatPercent(order.marginPct)}
        </span>

        <ChevronDown
          className={cn(
            'h-4 w-4 justify-self-end text-ink-subtle transition-transform duration-200',
            isOpen && 'rotate-180',
          )}
          aria-hidden="true"
        />
      </button>

      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <OrderDetail order={order} />
          </motion.div>
        )}
      </AnimatePresence>
    </li>
  )
}

function OrderDetail({ order }: { order: Order }) {
  const original = (value: number) => `${formatNumber(value)} ${order.currency}`

  const rows: Array<{ label: string; value: string }> = [
    { label: 'Customer', value: order.customerName || '—' },
    { label: 'Quantity', value: formatNumber(order.qty) },
    { label: `Price (${order.currency})`, value: original(order.priceOriginal) },
    { label: `Net price (${order.currency})`, value: original(order.netPriceOriginal) },
    { label: `Commission (${order.currency})`, value: original(order.commissionOriginal) },
    { label: `Shipping (${order.currency})`, value: original(order.shipmentOriginal) },
    { label: 'Revenue (PLN)', value: formatPLNExact(order.revenuePLN) },
    {
      label: 'Profit (PLN)',
      value: order.isComplete ? formatPLNExact(order.marginPLN) : 'Unreadable row',
    },
  ]

  return (
    <dl className="grid grid-cols-2 gap-x-8 gap-y-3 border-t border-hairline bg-surface-sunken/40 px-5 py-4 sm:grid-cols-4">
      {rows.map((row) => (
        <div key={row.label}>
          <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            {row.label}
          </dt>
          <dd className="tnum mt-0.5 text-[13px] text-ink">{row.value}</dd>
        </div>
      ))}
      {!order.isComplete && (
        <div className="col-span-2 sm:col-span-4">
          <p className="text-[12px] text-caution">
            This row is missing its PLN conversion in the source sheet, so it is excluded from all
            profit totals.
          </p>
        </div>
      )}
    </dl>
  )
}
