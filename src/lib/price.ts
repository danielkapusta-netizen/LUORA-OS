// Gross selling prices as typed by staff and as marketplaces return them. Always kept as text with
// two decimals, so "49,99", "49.9" and 49.99 all become "49.99" and nothing drifts through floats.

/** Highest price accepted; guards against a stray extra digit. */
export const MAX_PRICE = 99_999.99;

/** "49,99", "49.9", " 50 " → "49.99" / "49.90" / "50.00"; null when it isn't a price above zero. */
export function parsePrice(input: unknown): string | null {
  if (typeof input === 'number') input = String(input);
  if (typeof input !== 'string') return null;
  const text = input.trim().replace(/\s/g, '').replace(/(zł|pln)$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  const value = Number(text);
  if (!(value > 0) || value > MAX_PRICE) return null;
  return value.toFixed(2);
}

/** Same price, ignoring formatting. A missing price is never the same as a price. */
export function samePrice(a: string | number | null | undefined, b: string | number | null | undefined): boolean {
  if (a == null || b == null || a === '' || b === '') return false;
  return Math.abs(Number(a) - Number(b)) < 0.005;
}

/** Change from one price to another in percent (positive = dearer), or null when there is nothing to compare with. */
export function priceChangePercent(from: string | number | null | undefined, to: string | number | null | undefined): number | null {
  if (from == null || to == null || from === '' || to === '') return null;
  const base = Number(from);
  if (!(base > 0)) return null;
  return ((Number(to) - base) / base) * 100;
}

export function formatPrice(price: string | number | null | undefined, currency?: string | null): string {
  if (price == null || price === '') return '—';
  const text = Number(price).toLocaleString('pl-PL', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return !currency || currency === 'PLN' ? `${text} zł` : `${text} ${currency}`;
}
