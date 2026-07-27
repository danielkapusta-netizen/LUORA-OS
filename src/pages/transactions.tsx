import { AnimatePresence, motion } from 'framer-motion'
import { ChevronDown, Package, Search, Truck } from 'lucide-react'
import { useMemo, useState } from 'react'

import { PageHeader } from '@/components/page-header'
import { PeriodSelector } from '@/components/period-selector'
import { EmptyState, ErrorState, PageSkeleton } from '@/components/states'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { Segmented } from '@/components/ui/segmented'
import { channelName } from '@/domain/insights'
import type { LineItem, Order } from '@/domain/types'
import { useSnapshot } from '@/hooks/use-snapshot'
import { formatDate, formatNumber, formatPercent, formatPLN, formatPLNExact } from '@/lib/format'
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

const PAGE_SIZE = 30

/**
 * One row is one order.
 *
 * The sheet stores a row per product line, so a three-item basket previously
 * appeared as three "orders" — inflating volume and making average basket
 * meaningless. Lines are grouped upstream in the domain layer; this page shows
 * the order and opens to reveal the lines inside it.
 */
export function TransactionsPage() {
  const {
    snapshot,
    period,
    periodKey,
    setPeriodKey,
    setCustomRange,
    isLoading,
    isError,
    error,
    refetch,
  } = useSnapshot()

  const [channel, setChannel] = useState<ChannelFilter>('all')
  const [marginBand, setMarginBand] = useState<MarginFilter>('all')
  const [search, setSearch] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE)

  const filtered = useMemo(() => {
    if (!snapshot) return []
    const query = search.trim().toLowerCase()
    return snapshot.orders.filter((order) => {
      if (channel !== 'all' && order.source !== channel) return false
      if (marginBand === 'healthy' && !(order.marginPct !== null && order.marginPct >= 15))
        return false
      if (marginBand === 'thin' && !(order.marginPct !== null && order.marginPct < 15)) return false
      if (
        query &&
        !order.customerName.toLowerCase().includes(query) &&
        !order.items.some((item) => item.productLabel.toLowerCase().includes(query))
      )
        return false
      return true
    })
  }, [snapshot, channel, marginBand, search])

  if (isLoading) return <PageSkeleton />
  if (isError || !snapshot || !period) {
    return (
      <div className="space-y-8">
        <PageHeader eyebrow="Transactions" title="Transactions" />
        <ErrorState description={error?.message} onRetry={refetch} />
      </div>
    )
  }

  const visible = filtered.slice(0, visibleCount)
  const filteredRevenue = filtered.reduce((total, order) => total + order.revenuePLN, 0)
  const filteredProfit = filtered.reduce((total, order) => total + order.marginPLN, 0)
  const multiItem = filtered.filter((order) => order.lineCount > 1).length

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Transactions"
        title="Every order, explorable"
        description={
          <>
            {formatNumber(filtered.length)} orders in this view —{' '}
            <span className="tnum font-medium text-ink">{formatPLN(filteredRevenue)}</span> revenue,{' '}
            <span className="tnum font-medium text-ink">{formatPLN(filteredProfit)}</span> profit.
            {multiItem > 0 && ` ${formatNumber(multiItem)} contain more than one product.`}
          </>
        }
        actions={
          <PeriodSelector
            value={periodKey}
            label={period.label}
            onChange={(key) => {
              setCustomRange(null)
              setPeriodKey(key)
              setVisibleCount(PAGE_SIZE)
            }}
            onCustom={(from, to) => {
              setCustomRange({ from, to })
              setPeriodKey('custom')
              setVisibleCount(PAGE_SIZE)
            }}
          />
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
            description="Loosen the search, widen the period, or clear the margin filter."
          />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden border-b border-hairline bg-surface-sunken/50 px-5 py-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle sm:grid sm:grid-cols-[104px_1fr_78px_96px_104px_82px_28px] sm:gap-4">
            <span>Date</span>
            <span>Order</span>
            <span>Channel</span>
            <span className="text-right">Revenue</span>
            <span className="text-right">Profit</span>
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
              <Button
                variant="secondary"
                onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}
              >
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
  const summary =
    order.lineCount === 1
      ? (order.items[0]?.productLabel ?? 'Order')
      : `${order.lineCount} products · ${order.items[0]?.productLabel ?? ''}`

  return (
    <li className="border-b border-hairline last:border-b-0">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className={cn(
          'grid w-full grid-cols-[1fr_28px] items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-surface-sunken/50',
          'sm:grid-cols-[104px_1fr_78px_96px_104px_82px_28px] sm:gap-4',
          isOpen && 'bg-surface-sunken/50',
        )}
      >
        <span className="hidden text-[12px] text-ink-muted sm:block">
          {order.date ? formatDate(order.date) : '—'}
        </span>

        <span className="min-w-0">
          <span className="flex items-center gap-2">
            <span className="truncate text-[13px] font-medium text-ink">{summary}</span>
            {order.lineCount > 1 && (
              <Badge variant="accent" size="sm" className="shrink-0">
                <Package className="h-3 w-3" aria-hidden="true" />
                {order.lineCount}
              </Badge>
            )}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-ink-subtle">
            {order.customerName || 'Unnamed customer'}
            <span className="sm:hidden">
              {' · '}
              {order.date ? formatDate(order.date) : 'No date'} · {formatPLN(order.revenuePLN)}
            </span>
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

/**
 * The expanded order: its product lines, then the money broken out. Commission
 * and shipping are converted to PLN using the rate implied by each line's own
 * price conversion, so a HUF order reconciles in the same column as a PLN one.
 */
function OrderDetail({ order }: { order: Order }) {
  const currencies = [...new Set(order.items.map((item) => item.currency))]
  const cogs = order.revenuePLN - order.commissionPLN - order.shipmentPLN - order.marginPLN

  /** Deductions print with one sign, taken from the value itself. */
  const deduction = (value: number) =>
    `${value < 0 ? '+' : '−'}${formatPLNExact(Math.abs(value))}`

  const breakdown: Array<{ label: string; value: string; tone?: 'negative' | 'positive' }> = [
    { label: 'Revenue', value: formatPLNExact(order.revenuePLN) },
    { label: 'Marketplace commission', value: deduction(order.commissionPLN), tone: 'negative' },
    { label: 'Shipping', value: deduction(order.shipmentPLN), tone: 'negative' },
    { label: 'Product cost', value: deduction(cogs), tone: 'negative' },
    {
      label: 'Profit',
      value: formatPLNExact(order.marginPLN),
      tone: order.marginPLN >= 0 ? 'positive' : 'negative',
    },
  ]

  return (
    <div className="space-y-5 border-t border-hairline bg-surface-sunken/40 px-5 py-5">
      <div>
        <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
          Products in this order
        </p>
        <ul className="space-y-2">
          {order.items.map((item) => (
            <LineRow key={item.id} item={item} />
          ))}
        </ul>
      </div>

      <div className="grid grid-cols-1 gap-6 border-t border-hairline pt-4 sm:grid-cols-[1fr_260px]">
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Customer
            </dt>
            <dd className="mt-0.5 text-[13px] text-ink">{order.customerName || '—'}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Placed
            </dt>
            <dd className="mt-0.5 text-[13px] text-ink">
              {order.date ? order.date.toLocaleString('en-GB') : '—'}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Settled in
            </dt>
            <dd className="mt-0.5 text-[13px] text-ink">{currencies.join(', ')}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Units
            </dt>
            <dd className="tnum mt-0.5 text-[13px] text-ink">{formatNumber(order.units)}</dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Shipping charged
            </dt>
            <dd className="tnum mt-0.5 flex items-center gap-1.5 text-[13px] text-ink">
              <Truck className="h-3.5 w-3.5 text-ink-subtle" aria-hidden="true" />
              {formatPLNExact(order.shipmentPLN)}
            </dd>
          </div>
          <div>
            <dt className="text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
              Margin
            </dt>
            <dd className="tnum mt-0.5 text-[13px] text-ink">{formatPercent(order.marginPct)}</dd>
          </div>
        </dl>

        <div className="rounded-xl border border-hairline bg-surface p-4">
          <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.08em] text-ink-subtle">
            Where the money went
          </p>
          {!order.isComplete ? (
            // A breakdown built from blank cells would be arithmetic on nothing.
            <p className="text-[12px] leading-relaxed text-ink-muted">
              This order is still being calculated in the source sheet. Its figures will appear
              once the conversion and margin columns are filled.
            </p>
          ) : (
          <dl className="space-y-2">
            {breakdown.map((row, index) => (
              <div
                key={row.label}
                className={cn(
                  'flex items-baseline justify-between gap-4',
                  index === breakdown.length - 1 && 'border-t border-hairline pt-2',
                )}
              >
                <dt className="text-[12px] text-ink-muted">{row.label}</dt>
                <dd
                  className={cn(
                    'tnum text-[12px] font-medium',
                    row.tone === 'negative'
                      ? 'text-negative'
                      : row.tone === 'positive'
                        ? 'text-positive'
                        : 'text-ink',
                  )}
                >
                  {row.value}
                </dd>
              </div>
            ))}
          </dl>
          )}
        </div>
      </div>

      {!order.isComplete && (
        <p className="text-[12px] text-caution">
          At least one line in this order is missing its PLN conversion in the source sheet, so the
          order is excluded from profit totals.
        </p>
      )}
    </div>
  )
}

function LineRow({ item }: { item: LineItem }) {
  return (
    <li className="flex items-baseline justify-between gap-4 rounded-lg bg-surface px-3 py-2">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] text-ink" title={item.rawSku}>
          {item.productLabel}
        </span>
        <span className="tnum mt-0.5 block text-[11px] text-ink-subtle">
          {item.qty} × {formatNumber(item.priceOriginal)} {item.currency}
          {item.currency !== 'PLN' && ` · ${formatPLNExact(item.revenuePLN)}`}
        </span>
      </span>
      <span className="tnum shrink-0 text-right text-[12px] text-ink-muted">
        {formatPLNExact(item.revenuePLN)}
      </span>
      <span className="tnum w-16 shrink-0 text-right text-[12px] font-medium text-ink">
        {formatPercent(item.marginPct)}
      </span>
    </li>
  )
}
