/**
 * Defensive coercion for spreadsheet-backed data.
 *
 * The sheet emits empty strings for blank cells, so `margin` may legitimately
 * arrive as `""` on a row that is otherwise valid. Every value crossing the
 * network boundary passes through here.
 */

/** Coerce a spreadsheet cell to a finite number, or null when unusable. */
export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (trimmed === '') return null
    // Sheets may localise decimals with a comma and group with spaces.
    const normalised = trimmed.replace(/\s/g, '').replace(',', '.')
    const parsed = Number(normalised)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

/** Coerce to a number, falling back to `fallback` when the cell is unusable. */
export function toNumberOr(value: unknown, fallback: number): number {
  return toNumber(value) ?? fallback
}

export function toText(value: unknown): string {
  if (typeof value === 'string') return value.trim()
  if (typeof value === 'number') return String(value)
  return ''
}

/** Parse an ISO timestamp, tolerating blanks and malformed values. */
export function toDate(value: unknown): Date | null {
  const text = toText(value)
  if (!text) return null
  const parsed = new Date(text)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

/** `YYYY-MM-DD` in UTC — the grain all daily aggregation happens on. */
export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

/** Percentage change, or null when the baseline is zero or missing. */
export function percentChange(current: number, previous: number): number | null {
  if (!Number.isFinite(previous) || previous === 0) return null
  return ((current - previous) / Math.abs(previous)) * 100
}

/** Safe ratio that never yields Infinity or NaN. */
export function ratio(numerator: number, denominator: number): number {
  if (!denominator) return 0
  const result = numerator / denominator
  return Number.isFinite(result) ? result : 0
}

export function sum<T>(items: readonly T[], pick: (item: T) => number): number {
  return items.reduce((total, item) => total + pick(item), 0)
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  if (sorted.length % 2 === 1) return sorted[mid] ?? 0
  return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2
}
