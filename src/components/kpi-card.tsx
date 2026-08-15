import { motion } from 'framer-motion'
import { Info } from 'lucide-react'

import { AnimatedNumber } from '@/components/animated-number'
import { Sparkline } from '@/components/charts/sparkline'
import { Delta } from '@/components/delta'
import { Card } from '@/components/ui/card'
import { Tooltip } from '@/components/ui/tooltip'
import type { Kpi } from '@/domain/types'
import { formatDateShort, formatNumber, formatPercent, formatPLN } from '@/lib/format'
import { rise } from '@/lib/motion'

function formatterFor(kpi: Kpi): (value: number) => string {
  switch (kpi.format) {
    case 'pln':
      return formatPLN
    case 'percent':
      return (value) => formatPercent(value)
    case 'number':
    default:
      return formatNumber
  }
}

/**
 * A KPI in context: what it is, what it was, where it peaked, what is typical,
 * and its shape. The peak and average are what turn "12,400 zł" from a number
 * into a judgement — without them there is no way to know if today was good.
 */
export function KpiCard({
  kpi,
  comparisonLabel,
  index = 0,
}: {
  kpi: Kpi
  comparisonLabel: string
  index?: number
}) {
  const format = formatterFor(kpi)
  const tone = kpi.key === 'profit' ? 'positive' : kpi.key === 'margin' ? 'neutral' : 'accent'

  return (
    <motion.div {...rise(index)}>
      <Card className="group h-full overflow-hidden hover:shadow-lifted">
        <div className="flex h-full flex-col p-5">
          <div className="flex items-start justify-between gap-3">
            <p className="t-label text-ink-subtle">
              {kpi.label}
            </p>
            <Tooltip content={kpi.hint}>
              <button
                type="button"
                aria-label={`How ${kpi.label} is calculated`}
                className="text-ink-subtle opacity-0 transition-opacity duration-200 hover:text-ink-muted focus-visible:opacity-100 group-hover:opacity-100"
              >
                <Info className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </Tooltip>
          </div>

          <p className="mt-2.5 text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
            <AnimatedNumber value={kpi.value} format={format} />
          </p>

          <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1">
            <Delta
              value={kpi.changePct}
              unit={kpi.isRate ? 'pp' : 'percent'}
              higherIsBetter={kpi.higherIsBetter ?? true}
            />
            <span className="t-micro text-ink-subtle">{comparisonLabel}</span>
          </div>

          {kpi.series.length > 1 && (
            <div className="-mx-1 mt-4">
              <Sparkline data={kpi.series} tone={tone} height={36} />
            </div>
          )}

          {/* Context row: what the previous window was, where it peaked, and
              what a typical bucket looks like. */}
          <dl className="mt-auto grid grid-cols-3 gap-2 border-t border-hairline pt-3 t-micro">
            <div>
              <dt className="text-ink-subtle">Previous</dt>
              <dd className="tnum mt-0.5 font-medium text-ink-muted">
                {kpi.previous === null ? '—' : format(kpi.previous)}
              </dd>
            </div>
            <div>
              <dt className="text-ink-subtle">Peak</dt>
              <dd className="tnum mt-0.5 font-medium text-ink-muted">
                {kpi.peak ? format(kpi.peak.value) : '—'}
              </dd>
              {kpi.peak && (
                <dd className="mt-0.5 text-[10px] text-ink-subtle">
                  {formatDateShort(kpi.peak.label)}
                </dd>
              )}
            </div>
            <div>
              <dt className="text-ink-subtle">Average</dt>
              <dd className="tnum mt-0.5 font-medium text-ink-muted">{format(kpi.average)}</dd>
            </div>
          </dl>
        </div>
      </Card>
    </motion.div>
  )
}
