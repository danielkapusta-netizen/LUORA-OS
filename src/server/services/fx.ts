// Exchange rates for analytics: NBP table A mid rates stored per business day, so every order is
// converted to PLN at the rate of the day it was placed (the last published rate on or before it).
import { and, asc, eq, gte, lte } from 'drizzle-orm';
import { getDb, insertMany } from '../db/client';
import { fxRates, orders } from '../db/schema';
import { isMockMode } from '../env';
import { addDays, nbpRates } from '../integrations/accounting/nbp';

/** Rates are looked up to this many days back when the day itself has none (weekends, holidays). */
const LOOKBACK_DAYS = 10;
/** A gap this long between stored rates means a range was never fetched. */
const GAP_DAYS = 5;

const MOCK_BASE: Record<string, number> = { EUR: 4.3, USD: 3.9, CZK: 0.17, HUF: 0.011, GBP: 5.0 };

/** Demo mode: a stable rate per currency with a small daily wobble, published on weekdays only. */
function mockRates(currency: string, from: string, to: string): { day: string; rate: number }[] {
  const base = MOCK_BASE[currency] ?? 1;
  const out: { day: string; rate: number }[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    const wobble = Math.sin(Date.parse(day) / 86_400_000 / 9) * 0.01;
    out.push({ day, rate: Math.round(base * (1 + wobble) * 10000) / 10000 });
  }
  return out;
}

export const today = () => new Date().toISOString().slice(0, 10);

/** Ranges of [from, to] not yet covered by stored rates of `currency`. */
export function missingRanges(stored: string[], from: string, to: string): [string, string][] {
  const gaps: [string, string][] = [];
  let cursor = from;
  for (const day of [...stored].sort()) {
    if (day < from || day > to) continue;
    if (addDays(cursor, GAP_DAYS) <= day) gaps.push([cursor, addDays(day, -1)]);
    cursor = addDays(day, 1);
  }
  if (addDays(cursor, GAP_DAYS) <= addDays(to, 1) || (stored.length === 0 && cursor <= to)) gaps.push([cursor, to]);
  return gaps.filter(([a, b]) => a <= b);
}

/** Makes sure rates of `currencies` between two days are stored, fetching only what is missing. */
export async function ensureFxRates(currencies: Iterable<string>, from: string, to: string = today()): Promise<number> {
  const db = getDb();
  const start = addDays(from, -LOOKBACK_DAYS);
  let added = 0;
  for (const currency of new Set([...currencies].map((c) => c.toUpperCase()))) {
    if (currency === 'PLN') continue;
    const stored = await db
      .select({ day: fxRates.day })
      .from(fxRates)
      .where(and(eq(fxRates.currency, currency), gte(fxRates.day, start), lte(fxRates.day, to)));
    for (const [a, b] of missingRanges(stored.map((r) => r.day), start, to)) {
      const rows = isMockMode() ? mockRates(currency, a, b) : await nbpRates(currency, a, b);
      if (!rows.length) continue;
      await insertMany(
        db,
        fxRates,
        rows.map((r) => ({ currency, day: r.day, rate: r.rate })),
        { onConflictDoNothing: true },
      );
      added += rows.length;
    }
  }
  return added;
}

/** Looks up PLN rates in memory; built once per calculation from the stored table. */
export interface FxTable {
  /** PLN per unit of `currency` on `day` (or the last business day before); null when unknown. */
  rate(currency: string, day: string): number | null;
}

export async function loadFxTable(currencies: Iterable<string>, from: string, to: string): Promise<FxTable> {
  const wanted = [...new Set([...currencies].map((c) => c.toUpperCase()))].filter((c) => c !== 'PLN');
  const byCurrency = new Map<string, { day: string; rate: number }[]>();
  for (const currency of wanted) {
    const rows = await getDb()
      .select({ day: fxRates.day, rate: fxRates.rate })
      .from(fxRates)
      .where(and(eq(fxRates.currency, currency), gte(fxRates.day, addDays(from, -LOOKBACK_DAYS)), lte(fxRates.day, to)))
      .orderBy(asc(fxRates.day));
    byCurrency.set(currency, rows);
  }
  return {
    rate(currency, day) {
      const c = currency.toUpperCase();
      if (c === 'PLN') return 1;
      const rows = byCurrency.get(c);
      if (!rows?.length) return null;
      // Binary search for the last rate on or before `day`.
      let lo = 0;
      let hi = rows.length - 1;
      let found = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        if (rows[mid].day <= day) {
          found = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      if (found < 0 || rows[found].day < addDays(day, -LOOKBACK_DAYS)) return null;
      return rows[found].rate;
    },
  };
}

/** PLN per unit of `currency` on `day`, fetching the rate if needed. Null when NBP has none. */
export async function plnRateOn(currency: string, day: string = today()): Promise<number | null> {
  if (currency.toUpperCase() === 'PLN') return 1;
  try {
    await ensureFxRates([currency], day, day);
  } catch (err) {
    console.error(`[fx] no NBP rate for ${currency}:`, err instanceof Error ? err.message : err);
  }
  return (await loadFxTable([currency], day, day)).rate(currency, day);
}

/** Daily job: rates for every currency orders were placed in, from the oldest order on. */
export async function syncFxRates(): Promise<{ added: number }> {
  const db = getDb();
  const currencies = await db.selectDistinct({ currency: orders.currency }).from(orders);
  const [oldest] = await db.select({ placedAt: orders.placedAt }).from(orders).orderBy(asc(orders.placedAt)).limit(1);
  if (!oldest) return { added: 0 };
  const added = await ensureFxRates(
    currencies.map((c) => c.currency),
    oldest.placedAt.toISOString().slice(0, 10),
  );
  return { added };
}
