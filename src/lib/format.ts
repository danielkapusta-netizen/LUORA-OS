/**
 * Presentation-neutral formatting. Pure functions, shared by the domain layer
 * (for insight copy) and the UI (for display).
 *
 * The product is English-language but sells in Poland, so figures use English
 * numeric conventions with a `zł` suffix — unambiguous for an international
 * founder, still native to the market.
 */

const decimal = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 })
const decimalPrecise = new Intl.NumberFormat('en-GB', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
})
const compact = new Intl.NumberFormat('en-GB', {
  notation: 'compact',
  maximumFractionDigits: 1,
})

/** Money, rounded to whole złoty — cents are noise at dashboard altitude. */
export function formatPLN(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${decimal.format(value)} zł`
}

/** Money with cents, for row-level detail where exactness matters. */
export function formatPLNExact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${decimalPrecise.format(value)} zł`
}

/** Abbreviated money for axis labels and dense chips. */
export function formatPLNCompact(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${compact.format(value)} zł`
}

export function formatNumber(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return decimal.format(value)
}

export function formatPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value.toFixed(digits)}%`
}

/** Percentage with an explicit sign, for deltas. */
export function formatSignedPercent(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : ''
  return `${sign}${value.toFixed(digits)}%`
}

export function formatSignedPLN(value: number): string {
  if (!Number.isFinite(value)) return '—'
  const sign = value > 0 ? '+' : value < 0 ? '−' : ''
  return `${sign}${decimal.format(Math.abs(value))} zł`
}

/** `17 Jul 2026` */
export function formatDate(value: Date | string | null): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** `17 Jul` — for axis ticks and compact ranges. */
export function formatDateShort(value: Date | string | null): string {
  if (!value) return '—'
  const date = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

/** `8 – 17 Jul 2026`, collapsing repeated month and year. */
export function formatDateRange(from: Date | string | null, to: Date | string | null): string {
  if (!from || !to) return '—'
  const start = typeof from === 'string' ? new Date(from) : from
  const end = typeof to === 'string' ? new Date(to) : to
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return '—'

  const sameMonth =
    start.getUTCFullYear() === end.getUTCFullYear() && start.getUTCMonth() === end.getUTCMonth()

  if (sameMonth) {
    return `${start.getUTCDate()} – ${formatDate(end)}`
  }
  return `${formatDateShort(start)} – ${formatDate(end)}`
}

/** How stale the data is, phrased for a human. */
export function formatFreshness(lastOrder: Date | null, now: Date = new Date()): string {
  if (!lastOrder) return 'No dated orders'
  const days = Math.floor((now.getTime() - lastOrder.getTime()) / 86_400_000)
  if (days <= 0) return 'Up to date'
  if (days === 1) return '1 day behind'
  return `${days} days behind`
}
