/**
 * SKU reconciliation.
 *
 * Transaction rows carry marketplace listing titles, which differ from the
 * titles used in the cost sheet in four ways:
 *   1. an appended marketplace offer id — `… 30 ml (18505316304)`
 *   2. multi-item orders joined with a semicolon — `Item A (123); Item B (456)`
 *   3. a trailing quantity descriptor — `… (18567889961) 1 sztuka`
 *   4. incidental punctuation and whitespace drift
 *
 * Each of these splits one product into several. Left unhandled, case 3 alone
 * reported a single Centellian24 serum as two separate products, halving its
 * revenue and surfacing it twice in the same recommendation list.
 *
 * Matching on the raw string recovers 148 of 183 orders; normalising here
 * recovers 173. That difference is the whole reason this module exists, and it
 * belongs in the domain layer — never in a component.
 */

const OFFER_ID = /\((\d{6,})\)/g
const PUNCTUATION = /[–—−]/g
const NOISE = /[^\p{L}\p{N}\s.+]/gu
/** Trailing pack-size noise: `1 sztuka`, `2 szt.`, `opakowanie`. */
const QUANTITY_SUFFIX = /\s*[-–]?\s*\b(\d+\s*)?(sztuk[ai]?|szt\.?|opak\.?|opakowani[ae])\s*$/i

/** Strip the marketplace offer id and collapse whitespace for display. */
export function cleanSkuLabel(raw: string): string {
  return raw.replace(OFFER_ID, '').replace(/\s+/g, ' ').trim()
}

/** A stable, comparable key for joining orders to cost records. */
export function skuKey(raw: string): string {
  const base = cleanSkuLabel(raw)
    .replace(PUNCTUATION, '-')
    .replace(NOISE, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  // Applied repeatedly: `… 1 sztuka opak.` sheds one descriptor per pass.
  let key = base
  let previous: string
  do {
    previous = key
    key = key.replace(QUANTITY_SUFFIX, '').trim()
  } while (key !== previous && key.length > 0)

  return key || base
}

/**
 * Split a multi-item SKU string into its constituent listings.
 * A bundled order still counts once, but it can match any of its parts.
 */
export function splitSkuParts(raw: string): string[] {
  return raw
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
}

/** The primary listing of an order — the first item in a bundle. */
export function primarySku(raw: string): string {
  return splitSkuParts(raw)[0] ?? raw
}

/**
 * Resolve an order's SKU against a cost index, trying the exact key first and
 * then each part of a bundle. Returns the matched key, or null when the product
 * has no cost record at all (its margin is therefore overstated).
 */
export function resolveCostKey(rawSku: string, costIndex: ReadonlyMap<string, unknown>): string | null {
  const whole = skuKey(rawSku)
  if (costIndex.has(whole)) return whole

  for (const part of splitSkuParts(rawSku)) {
    const key = skuKey(part)
    if (costIndex.has(key)) return key
  }
  return null
}

/**
 * Shorten a long marketplace title for display in dense UI without losing the
 * brand, which is always the leading token.
 */
export function shortLabel(label: string, maxLength = 48): string {
  const clean = cleanSkuLabel(label)
  if (clean.length <= maxLength) return clean
  return `${clean.slice(0, maxLength - 1).trimEnd()}…`
}
