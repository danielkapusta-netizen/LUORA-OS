'use client';

import { useState, useTransition } from 'react';
import { buttonClass, Field, Input, Select } from '@/components/ui';
import { buildMarginBenchmark, emptyCandidate, evaluateCandidate, SOURCE_CURRENCIES, type Candidate, type ChannelRate } from '@/lib/analytics/calculator';
import type { Channel, ProductPerformance } from '@/lib/analytics/types';
import { cn } from '@/lib/utils';
import { Waterfall } from './charts';
import { formatValue } from './format';
import { useT } from '@/lib/i18n/client';

const CHANNELS: { value: Channel; label: string }[] = [
  { value: 'allegro', label: 'Allegro' },
  { value: 'empik', label: 'Empik' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'vonhalsky', label: 'Von Halsky' },
  { value: 'hebe', label: 'HEBE' },
];

const VERDICT = {
  buy: 'border-emerald-300 bg-emerald-50 text-emerald-900',
  negotiate: 'border-amber-300 bg-amber-50 text-amber-900',
  reprice: 'border-amber-300 bg-amber-50 text-amber-900',
  pass: 'border-red-300 bg-red-50 text-red-900',
  incomplete: 'border-slate-200 bg-slate-50 text-slate-700',
} as const;

const num = (v: string) => {
  const n = Number(v.replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
};

/** "Will this product make money?" — evaluated live as the quote is typed in. */
export function Calculator({
  rates,
  fx,
  products,
  saved,
  save,
  remove,
}: {
  rates: Record<Channel, ChannelRate>;
  /** Today's NBP rate per currency, to prefill the conversion. */
  fx: Record<string, number>;
  products: ProductPerformance[];
  saved: Candidate[];
  save: (c: Candidate) => Promise<string>;
  remove: (id: string) => Promise<void>;
}) {
  const t = useT();
  const [candidate, setCandidate] = useState<Candidate>(() => emptyCandidate(crypto.randomUUID()));
  const [pending, start] = useTransition();
  const result = evaluateCandidate(candidate, { rates });
  const benchmark = result.isIncomplete ? null : buildMarginBenchmark(products, result.marginPct);
  const cost = candidate.cost;
  const setCost = (patch: Partial<Candidate['cost']>) => setCandidate({ ...candidate, cost: { ...cost, ...patch } });
  const rate = rates[candidate.channel];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="space-y-4 rounded-2xl border border-black/5 bg-white p-5">
          <Field label={t('Product')} hint={t('For your own reference in the comparison table.')}>
            <Input value={candidate.label} onChange={(e) => setCandidate({ ...candidate, label: e.target.value })} placeholder={t('e.g. Beauty of Joseon Relief Sun SPF50')} />
          </Field>
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('What it costs you')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Supplier unit price')}>
                <Input inputMode="decimal" value={cost.supplierUnitPrice || ''} onChange={(e) => setCost({ supplierUnitPrice: num(e.target.value) })} />
              </Field>
              <Field label={t('Currency')}>
                <Select
                  value={cost.currency}
                  onChange={(e) => {
                    const currency = e.target.value as Candidate['cost']['currency'];
                    setCost({ currency, fxRateToPLN: currency === 'PLN' ? 1 : (fx[currency] ?? cost.fxRateToPLN) });
                  }}
                >
                  {SOURCE_CURRENCIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              {cost.currency !== 'PLN' && (
                <Field label={`PLN per 1 ${cost.currency}`} hint={t('Today\'s NBP rate; change it to your bank\'s.')}>
                  <Input inputMode="decimal" value={cost.fxRateToPLN || ''} onChange={(e) => setCost({ fxRateToPLN: num(e.target.value) })} />
                </Field>
              )}
              <Field label={t('Freight per unit, PLN')}>
                <Input inputMode="decimal" value={cost.inboundFreightPLN || ''} onChange={(e) => setCost({ inboundFreightPLN: num(e.target.value) })} />
              </Field>
              <Field label={t('Duty per unit, PLN')}>
                <Input inputMode="decimal" value={cost.dutyPLN || ''} onChange={(e) => setCost({ dutyPLN: num(e.target.value) })} />
              </Field>
            </div>
            <p className="text-sm">
              {t('Landed cost:')} <span className="font-semibold tabular-nums">{result.landedCostPLN.toFixed(2)} zł</span>
            </p>
          </fieldset>
          <fieldset className="space-y-3 rounded-xl border border-slate-200 p-3">
            <legend className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{t('Where you sell it')}</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('Gross selling price, zł')}>
                <Input inputMode="decimal" value={candidate.sellingPricePLN || ''} onChange={(e) => setCandidate({ ...candidate, sellingPricePLN: num(e.target.value) })} />
              </Field>
              <Field label={t('Marketplace')}>
                <Select value={candidate.channel} onChange={(e) => setCandidate({ ...candidate, channel: e.target.value as Channel })}>
                  {CHANNELS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field
                label={t('Fees, % (optional)')}
                hint={rate.measured ? t('Your measured rate: {pct}% over {lines} lines.', { pct: (rate.rate * 100).toFixed(1), lines: rate.sampleLines }) : t('No sales yet; {pct}% assumed.', { pct: (rate.rate * 100).toFixed(0) })}
              >
                <Input
                  inputMode="decimal"
                  value={candidate.commissionRatePct ?? ''}
                  onChange={(e) => setCandidate({ ...candidate, commissionRatePct: e.target.value.trim() ? num(e.target.value) : null })}
                />
              </Field>
            </div>
          </fieldset>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass('primary')}
              disabled={pending || result.isIncomplete}
              onClick={() => start(async () => void (await save(candidate)))}
            >
              {pending ? t('Saving…') : t('Save for comparison')}
            </button>
            <button type="button" className={buttonClass('secondary')} onClick={() => setCandidate(emptyCandidate(crypto.randomUUID()))}>
              {t('New')}
            </button>
          </div>
        </div>

        <div className="space-y-4">
          <div className={cn('rounded-2xl border p-5', VERDICT[result.verdict.kind])}>
            <p className="text-xs font-semibold uppercase tracking-wide">{result.verdict.kind}</p>
            <p className="mt-1 text-lg font-semibold">{result.verdict.headline}</p>
            <ul className="mt-2 list-disc space-y-0.5 pl-5 text-sm">
              {result.verdict.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </div>
          {!result.isIncomplete && (
            <div className="space-y-4 rounded-2xl border border-black/5 bg-white p-5">
              <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                {[
                  [t('Margin'), formatValue(result.marginPct, 'percent', false, t.locale)],
                  [t('Profit / unit'), `${result.profitPerUnitPLN.toFixed(2)} zł`],
                  [t('Break-even price'), result.breakEvenPricePLN === null ? '—' : `${result.breakEvenPricePLN.toFixed(2)} zł`],
                  [t('Most you can pay'), result.maxPayableCostPLN === null ? '—' : `${result.maxPayableCostPLN.toFixed(2)} zł`],
                ].map(([k, v]) => (
                  <div key={k}>
                    <dt className="text-xs text-slate-500">{k}</dt>
                    <dd className="font-semibold tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              {result.suggestedPricePLN !== null && (
                <p className="text-sm text-slate-600">
                  {t('Suggested price for the target margin:')} <span className="font-semibold">{result.suggestedPricePLN.toFixed(2)} zł</span>
                </p>
              )}
              {benchmark && (
                <p className="text-sm text-slate-600">
                  {t('Better than {beats} of the {total} products you sell (median margin {median}%).', { beats: benchmark.beats, total: benchmark.comparedWith, median: benchmark.medianMarginPct.toFixed(1) })}
                </p>
              )}
              {result.waterfall && (
                <Waterfall
                  steps={result.waterfall.map((w) => ({
                    label: t(w.label),
                    value: w.kind === 'result' ? w.amountPLN : Math.abs(w.amountPLN),
                    kind: w.kind === 'start' ? 'start' : w.kind === 'result' ? 'total' : 'minus',
                  }))}
                />
              )}
              <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                {result.targets.map((target) => (
                  <li key={target.label} className="flex justify-between gap-2">
                    <span className={target.achieved ? 'text-emerald-700' : 'text-slate-600'}>{target.marginPct === 0 ? t('Break even') : t('{n}% margin', { n: Math.round(target.marginPct) })}</span>
                    <span className="tabular-nums">{target.requiredPricePLN === null ? '—' : `${target.requiredPricePLN.toFixed(2)} zł`}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {saved.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                {[t('Product'), t('Marketplace'), t('Landed cost'), t('Price'), t('Margin'), t('Verdict'), ''].map((h, idx) => (
                  <th key={idx} className="px-3 py-2 text-left text-xs font-medium uppercase tracking-wide text-slate-500">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {saved.map((c) => {
                const r = evaluateCandidate(c, { rates });
                return (
                  <tr key={c.id}>
                    <td className="px-3 py-2">
                      <button type="button" className="font-medium hover:underline" onClick={() => setCandidate(c)}>
                        {c.label || 'Unnamed'}
                      </button>
                    </td>
                    <td className="px-3 py-2">{CHANNELS.find((x) => x.value === c.channel)?.label}</td>
                    <td className="px-3 py-2 tabular-nums">{r.landedCostPLN.toFixed(2)} zł</td>
                    <td className="px-3 py-2 tabular-nums">{c.sellingPricePLN.toFixed(2)} zł</td>
                    <td className="px-3 py-2 tabular-nums">{formatValue(r.marginPct, 'percent')}</td>
                    <td className="px-3 py-2">{r.verdict.kind}</td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" className="text-xs text-red-700 hover:underline" onClick={() => start(async () => remove(c.id))}>
                        {t('Delete')}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
