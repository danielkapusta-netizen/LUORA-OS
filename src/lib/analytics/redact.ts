// For people who may see margins but not how much profit was made. Profit amounts are removed from the generated
// sentences; the pages hide the profit columns and charts themselves.
const AMOUNT = /\d[\d\s .,]*\s?(?:zł|PLN)/;
const PROFIT_FIGURE = /\bprofit\b[^.]*?\b(?:rose|dropped|grew|fell|growth|only|per (?:order|unit))\b|\b(?:grew|rose|fell)\s+[\d.]+%\s+(?:but|against|while)\b[^.]*\bprofit\b|\bprofit (?:per|growth)\b/i;

/** True when a sentence tells how much profit was made (an amount, or how it grew or fell). */
export function revealsProfit(sentence: string): boolean {
  if (!/\bprofit\b/i.test(sentence)) return false;
  return AMOUNT.test(sentence) || PROFIT_FIGURE.test(sentence);
}

/** Drops the sentences that reveal profit. Returns the fallback (or '') when nothing is left. */
export function scrubProfitText(text: string, fallback = ''): string {
  const kept = text.split(/(?<=[.!?])\s+/).filter((s) => !revealsProfit(s));
  return kept.length === 0 ? fallback : kept.join(' ');
}

/** Copies plain data, scrubbing every string in it. Dates and other objects pass through untouched. */
export function scrubDeep<T>(value: T): T {
  if (typeof value === 'string') return scrubProfitText(value) as T;
  if (Array.isArray(value)) return value.map((v) => scrubDeep(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubDeep(v)])) as T;
  }
  return value;
}

/** True when any string inside the value reveals profit. */
export function anyRevealsProfit(value: unknown): boolean {
  if (typeof value === 'string') return value.split(/(?<=[.!?])\s+/).some(revealsProfit);
  if (Array.isArray(value)) return value.some(anyRevealsProfit);
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) return Object.values(value).some(anyRevealsProfit);
  return false;
}

/** Generated answers and findings that are about profit made are left out as a whole. */
export function withoutProfitFigures<T>(items: readonly T[]): T[] {
  return items.filter((item) => !anyRevealsProfit(item));
}

/** Sets every `marginPLN` (profit in PLN) to zero, so a profit figure cannot leak into a page by accident. */
export function zeroProfit<T>(value: T): T {
  if (Array.isArray(value)) return value.map((v) => zeroProfit(v)) as T;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, k === 'marginPLN' ? 0 : zeroProfit(v)])) as T;
  }
  return value;
}
