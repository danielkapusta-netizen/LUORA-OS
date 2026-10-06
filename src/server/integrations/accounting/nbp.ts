// National Bank of Poland exchange rates (table A), needed on invoices in a foreign currency.
import { HttpError, request } from '../../http';

/** Shifts a YYYY-MM-DD date by whole days. */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Average NBP rate of `currency` from the last business day before `issueDate`, as VAT law requires
 * for invoices in a foreign currency.
 */
export async function nbpRateBefore(currency: string, issueDate: string): Promise<{ rate: number; date: string }> {
  const to = addDays(issueDate, -1);
  const from = addDays(issueDate, -10);
  const { data } = await request<{ rates: { effectiveDate: string; mid: number }[] }>(
    `https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/${from}/${to}/`,
    { query: { format: 'json' }, headers: { Accept: 'application/json' } },
  );
  const last = data.rates.at(-1);
  if (!last) throw new Error(`NBP has no ${currency} rate before ${issueDate}`);
  return { rate: last.mid, date: last.effectiveDate };
}

/** NBP answers at most this many days per range query. */
const MAX_RANGE_DAYS = 93;

/**
 * Every published table-A mid rate of `currency` between two YYYY-MM-DD dates (inclusive).
 * Ranges longer than NBP allows are split; a range with no business day returns nothing.
 */
export async function nbpRates(currency: string, from: string, to: string): Promise<{ day: string; rate: number }[]> {
  const out: { day: string; rate: number }[] = [];
  for (let start = from; start <= to; start = addDays(start, MAX_RANGE_DAYS)) {
    const end = addDays(start, MAX_RANGE_DAYS - 1) < to ? addDays(start, MAX_RANGE_DAYS - 1) : to;
    try {
      const { data } = await request<{ rates: { effectiveDate: string; mid: number }[] }>(
        `https://api.nbp.pl/api/exchangerates/rates/a/${currency.toLowerCase()}/${start}/${end}/`,
        { query: { format: 'json' }, headers: { Accept: 'application/json' } },
      );
      out.push(...data.rates.map((r) => ({ day: r.effectiveDate, rate: r.mid })));
    } catch (err) {
      // 404 = no table published in the range (a long weekend), not an error.
      if (!(err instanceof HttpError && err.status === 404)) throw err;
    }
  }
  return out;
}
