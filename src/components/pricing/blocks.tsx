import { Check, Minus } from 'lucide-react'
import { useMemo, useState } from 'react'

import { Badge } from '@/components/ui/badge'
import { Tooltip } from '@/components/ui/tooltip'
import {
  simulatePrice,
  type MarginHealth,
  type PricingRecommendation,
  type PricingRow,
  type PriceStatus,
  type WaterfallStep,
} from '@/domain/pricing'
import { formatPercent, formatPLN, formatPLNExact, formatSignedPLN } from '@/lib/format'
import { cn } from '@/lib/utils'

/* ── status & health ────────────────────────────────────────────────────── */

const STATUS_DOT: Record<PriceStatus, string> = {
  green: 'bg-positive',
  yellow: 'bg-caution',
  red: 'bg-negative',
}

const STATUS_COPY: Record<PriceStatus, string> = {
  green: 'Healthy — margin above 15%',
  yellow: 'Thin — margin between 10% and 15%',
  red: 'Unhealthy — margin below 10%',
}

export function StatusDot({ status }: { status: PriceStatus }) {
  return (
    <Tooltip content={STATUS_COPY[status]}>
      <span className="inline-flex cursor-help items-center">
        <span className={cn('h-2.5 w-2.5 rounded-full', STATUS_DOT[status])} aria-hidden="true" />
        <span className="sr-only">{STATUS_COPY[status]}</span>
      </span>
    </Tooltip>
  )
}

const HEALTH_META: Record<
  MarginHealth,
  { label: string; variant: 'positive' | 'accent' | 'neutral' | 'caution' | 'negative' }
> = {
  excellent: { label: 'Excellent', variant: 'positive' },
  healthy: { label: 'Healthy', variant: 'accent' },
  acceptable: { label: 'Acceptable', variant: 'neutral' },
  low: { label: 'Low', variant: 'caution' },
  critical: { label: 'Critical', variant: 'negative' },
  loss: { label: 'Loss', variant: 'negative' },
}

const HEALTH_ORDER: MarginHealth[] = ['loss', 'critical', 'low', 'acceptable', 'healthy', 'excellent']

/**
 * The six health bands as a single strip with the product's position marked —
 * one glance answers "where on the scale am I", which a lone label cannot.
 */
export function MarginHealthScale({ health }: { health: MarginHealth }) {
  const activeIndex = HEALTH_ORDER.indexOf(health)
  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <Badge variant={HEALTH_META[health].variant} size="md">
          {HEALTH_META[health].label}
        </Badge>
      </div>
      <div className="flex gap-1">
        {HEALTH_ORDER.map((band, index) => (
          <Tooltip key={band} content={HEALTH_META[band].label}>
            <span
              className={cn(
                'h-1.5 flex-1 rounded-full transition-colors',
                index === activeIndex
                  ? band === 'loss' || band === 'critical'
                    ? 'bg-negative'
                    : band === 'low'
                      ? 'bg-caution'
                      : band === 'acceptable'
                        ? 'bg-ink-subtle'
                        : 'bg-positive'
                  : 'bg-surface-sunken',
              )}
            />
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

/* ── margin targets ─────────────────────────────────────────────────────── */

/**
 * The ladder of prices this product needs to hit each margin. The current
 * average price is placed on the ladder so "am I above or below the line" is
 * read positionally rather than computed in the reader's head.
 */
export function MarginTargets({ row }: { row: PricingRow }) {
  if (row.unitCostPLN === null) {
    return (
      <p className="t-small text-ink-muted">
        No landed cost on file — target prices cannot be computed until this product is added to
        the cost sheet.
      </p>
    )
  }

  const isHealthyNow = row.averageMarginPct >= 10

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'flex items-baseline justify-between rounded-xl border px-4 py-3',
          isHealthyNow
            ? 'border-positive/25 bg-positive-soft/50'
            : 'border-negative/25 bg-negative-soft/50',
        )}
      >
        <span className="t-caption font-medium text-ink-muted">
          Current average price ({row.ordersInWindow} recent sales)
        </span>
        <span
          className={cn(
            'tnum text-[18px] font-semibold tracking-[-0.02em]',
            isHealthyNow ? 'text-positive' : 'text-negative',
          )}
        >
          {formatPLNExact(row.averagePricePLN)}
        </span>
      </div>

      <table className="w-full text-left">
        <thead>
          <tr className="t-label text-ink-subtle">
            <th className="pb-2 font-semibold">Target</th>
            <th className="pb-2 text-right font-semibold">Required price</th>
            <th className="w-16 pb-2 text-right font-semibold">Status</th>
          </tr>
        </thead>
        <tbody>
          {row.targets.map((target) => (
            <tr key={target.label} className="border-t border-hairline t-small">
              <td className="py-2 text-ink-muted">{target.label}</td>
              <td className="tnum py-2 text-right text-ink">
                {target.requiredPricePLN !== null ? formatPLNExact(target.requiredPricePLN) : '—'}
              </td>
              <td className="py-2 text-right">
                {target.requiredPricePLN === null ? (
                  <Tooltip content="Unreachable at this landed cost and commission — no price clears this margin.">
                    <span className="inline-flex cursor-help">
                      <Minus className="h-3.5 w-3.5 text-ink-subtle" aria-label="Unreachable" />
                    </span>
                  </Tooltip>
                ) : target.achieved ? (
                  <Check className="ml-auto h-3.5 w-3.5 text-positive" aria-label="Achieved" />
                ) : (
                  <span className="t-micro text-ink-subtle">
                    +{formatPLN(target.requiredPricePLN - row.averagePricePLN)}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/* ── profit waterfall ───────────────────────────────────────────────────── */

/**
 * Horizontal waterfall from gross price to net profit, per unit. Bars are
 * proportional to the selling price so the eye reads "how much of every złoty
 * survives" directly. Steps mirror the verified sheet formula — VAT,
 * commission, product cost — with no invented categories.
 */
export function ProfitWaterfall({ steps }: { steps: WaterfallStep[] }) {
  const start = steps[0]?.amountPLN ?? 0
  if (start <= 0) return null

  let cursor = start

  return (
    <ul className="space-y-2.5">
      {steps.map((step) => {
        const isStart = step.kind === 'start'
        const isResult = step.kind === 'result'
        const width = (Math.abs(step.amountPLN) / start) * 100
        const offset = isStart || isResult ? 0 : ((cursor - Math.abs(step.amountPLN)) / start) * 100
        if (step.kind === 'deduction') cursor -= Math.abs(step.amountPLN)

        return (
          <li key={step.label} className="grid grid-cols-[150px_1fr_90px] items-center gap-3">
            <span className="t-caption text-ink-muted">{step.label}</span>
            <div className="relative h-5 overflow-hidden rounded-md bg-surface-sunken">
              <div
                className={cn(
                  'absolute inset-y-0 rounded-md',
                  isStart && 'bg-accent/70',
                  step.kind === 'deduction' && 'bg-negative/50',
                  isResult && (step.amountPLN >= 0 ? 'bg-positive' : 'bg-negative'),
                )}
                style={{
                  left: `${Math.max(0, offset)}%`,
                  width: `${Math.max(1, width)}%`,
                }}
              />
            </div>
            <span
              className={cn(
                'tnum text-right t-caption font-medium',
                isResult ? (step.amountPLN >= 0 ? 'text-positive' : 'text-negative') : 'text-ink',
              )}
            >
              {step.kind === 'deduction'
                ? `−${formatPLNExact(Math.abs(step.amountPLN))}`
                : formatPLNExact(step.amountPLN)}
            </span>
          </li>
        )
      })}
    </ul>
  )
}

/* ── pricing simulator ──────────────────────────────────────────────────── */

/**
 * "What happens at price P" — answered live as the founder types. All maths is
 * `simulatePrice` in the domain layer; this component only formats.
 */
export function PricingSimulator({ row }: { row: PricingRow }) {
  const [input, setInput] = useState<string>(row.averagePricePLN.toFixed(2))
  const price = Number(input.replace(',', '.'))
  const result = useMemo(
    () => (Number.isFinite(price) && price > 0 ? simulatePrice(row, price) : null),
    [row, price],
  )

  if (row.unitCostPLN === null) {
    return (
      <p className="t-small text-ink-muted">
        The simulator needs a landed cost to project profit — add this product to the cost sheet
        first.
      </p>
    )
  }

  return (
    <div className="space-y-4">
      <label className="block max-w-[220px]">
        <span className="mb-1.5 block t-label text-ink-subtle">
          Try a selling price
        </span>
        <div className="relative">
          <input
            type="number"
            inputMode="decimal"
            step="0.10"
            min="0"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            className="tnum h-11 w-full rounded-control border border-hairline bg-surface pl-3 pr-10 text-[18px] font-semibold tracking-[-0.02em] text-ink"
            aria-label="Hypothetical selling price in PLN"
          />
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 t-small text-ink-subtle">
            zł
          </span>
        </div>
      </label>

      {result ? (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
          <SimStat
            label="Expected margin"
            value={formatPercent(result.marginPct)}
            tone={result.marginPct >= 15 ? 'positive' : result.marginPct >= 10 ? 'neutral' : 'negative'}
          />
          <SimStat
            label="Profit per unit"
            value={formatPLNExact(result.profitPerUnitPLN)}
            tone={result.profitPerUnitPLN >= 0 ? 'neutral' : 'negative'}
          />
          <SimStat
            label="Monthly profit"
            value={formatPLN(result.monthlyProfitPLN)}
            caption={`at ${row.monthlyUnits} units/month`}
          />
          <SimStat
            label="vs current price"
            value={formatSignedPLN(result.profitDeltaPerUnitPLN)}
            caption="per unit"
            tone={result.profitDeltaPerUnitPLN >= 0 ? 'positive' : 'negative'}
          />
          <SimStat
            label="vs current margin"
            value={`${result.marginDeltaPp >= 0 ? '+' : ''}${result.marginDeltaPp.toFixed(1)}pp`}
            tone={result.marginDeltaPp >= 0 ? 'positive' : 'negative'}
          />
          <SimStat
            label="Monthly difference"
            value={formatSignedPLN(result.monthlyDeltaPLN)}
            tone={result.monthlyDeltaPLN >= 0 ? 'positive' : 'negative'}
          />
        </dl>
      ) : (
        <p className="t-small text-ink-subtle">Enter a price to see its consequences.</p>
      )}
    </div>
  )
}

function SimStat({
  label,
  value,
  caption,
  tone = 'neutral',
}: {
  label: string
  value: string
  caption?: string
  tone?: 'positive' | 'negative' | 'neutral'
}) {
  return (
    <div>
      <dt className="t-label text-ink-subtle">
        {label}
      </dt>
      <dd
        className={cn(
          'tnum mt-1 text-[16px] font-semibold tracking-[-0.01em]',
          tone === 'positive' ? 'text-positive' : tone === 'negative' ? 'text-negative' : 'text-ink',
        )}
      >
        {value}
      </dd>
      {caption && <dd className="mt-0.5 t-micro text-ink-subtle">{caption}</dd>}
    </div>
  )
}

/* ── recommendation ─────────────────────────────────────────────────────── */

export function RecommendationBlock({ rec }: { rec: PricingRecommendation }) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-10 gap-y-4">
        <div>
          <p className="t-label text-ink-subtle">
            Current price
          </p>
          <p className="tnum mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink">
            {formatPLNExact(rec.currentPricePLN)}
          </p>
        </div>
        {rec.kind === 'raise' && rec.recommendedPricePLN !== null && (
          <>
            <div>
              <p className="t-label text-ink-subtle">
                Recommended price
              </p>
              <p className="tnum mt-1 text-[20px] font-semibold tracking-[-0.02em] text-accent-ink">
                {formatPLNExact(rec.recommendedPricePLN)}
              </p>
            </div>
            <div>
              <p className="t-label text-ink-subtle">
                Expected margin
              </p>
              <p className="tnum mt-1 text-[20px] font-semibold tracking-[-0.02em] text-positive">
                {formatPercent(rec.expectedMarginPct)}
              </p>
            </div>
            {rec.expectedMonthlyUpliftPLN !== null && (
              <div>
                <p className="t-label text-ink-subtle">
                  Monthly uplift
                </p>
                <p className="tnum mt-1 text-[20px] font-semibold tracking-[-0.02em] text-positive">
                  {formatSignedPLN(rec.expectedMonthlyUpliftPLN)}
                </p>
              </div>
            )}
          </>
        )}
        {rec.kind === 'hold' && (
          <Badge variant="positive" size="md">
            Hold current price
          </Badge>
        )}
        {rec.kind === 'fix-costs' && (
          <Badge variant="caution" size="md">
            Not a pricing decision
          </Badge>
        )}
        <div>
          <p className="t-label text-ink-subtle">
            Confidence
          </p>
          <p className="tnum mt-1 text-[20px] font-semibold tracking-[-0.02em] text-ink">
            {rec.confidencePct}%
          </p>
        </div>
      </div>

      <ul className="space-y-1.5">
        {rec.reasons.map((reason) => (
          <li key={reason} className="flex items-start gap-2 t-small text-ink-muted">
            <span className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-ink-subtle" aria-hidden="true" />
            {reason}
          </li>
        ))}
      </ul>
    </div>
  )
}
