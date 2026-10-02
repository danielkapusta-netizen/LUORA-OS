// National Bank of Poland exchange rates (table A), needed on invoices in a foreign currency.
import { request } from '../../http';

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
