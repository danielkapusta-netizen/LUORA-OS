'use client';

// "Where you sold": a rounded pill per marketplace, filled to its share of the day. The leader (or the one the page is
// filtered to) glows in the page's gradient with its value above it. A bar is also the filter: tap it to narrow the
// page to that marketplace, tap it again to see them all.
import Link from 'next/link';
import { useState } from 'react';
import { formatValue } from '@/components/analytics/format';
import { useLocale, useT } from '@/lib/i18n/client';
import { cn, MARKETPLACE_LABELS } from '@/lib/utils';
import { SegmentedToggle } from '../segmented-toggle';
import { dailyHref } from './day-header';

export interface SplitRow {
  marketplace: string;
  revenue: number;
  profit: number;
  orders: number;
}

type Metric = 'revenue' | 'profit' | 'orders';

export function MarketplaceBars({ rows, day, active, showProfit }: { rows: SplitRow[]; day: string | null; active: string | null; showProfit: boolean }) {
  const t = useT();
  const locale = useLocale();
  const [metric, setMetric] = useState<Metric>('revenue');
  const value = (r: SplitRow) => Math.max(0, r[metric]);
  const max = Math.max(1, ...rows.map(value));
  const total = rows.reduce((s, r) => s + value(r), 0);
  const leader = active ?? [...rows].sort((a, b) => value(b) - value(a))[0]?.marketplace ?? null;
  const show = (v: number) => (metric === 'orders' ? String(v) : formatValue(v, 'pln', true, locale));
  const options: { value: Metric; label: string }[] = [
    { value: 'revenue', label: t('Revenue') },
    ...(showProfit ? [{ value: 'profit' as const, label: t('Profit') }] : []),
    { value: 'orders', label: t('Orders') },
  ];
  const lead = rows.find((r) => r.marketplace === leader);
  return (
    <div className="daily-glass daily-rise flex h-full flex-col p-5 md:p-6" style={{ ['--i' as string]: 3 }}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">{t('Where you sold')}</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            {lead && total > 0
              ? t('{marketplace} brings {share} of the day', { marketplace: MARKETPLACE_LABELS[lead.marketplace] ?? lead.marketplace, share: `${Math.round((value(lead) / total) * 100)}%` })
              : t('No sales yet on this day.')}
          </p>
        </div>
        <SegmentedToggle options={options} value={metric} onChange={setMetric} label={t('Show')} />
      </div>
      {rows.length === 0 ? (
        <p className="mt-6 flex flex-1 items-center justify-center rounded-2xl bg-black/[0.02] px-4 py-10 text-sm text-slate-500">{t('No sales yet on this day.')}</p>
      ) : (
        <ul className="mt-8 grid flex-1 items-end gap-3" style={{ gridTemplateColumns: `repeat(${rows.length}, minmax(0, 1fr))` }}>
          {rows.map((r) => {
            const on = r.marketplace === leader;
            const share = value(r) / max;
            return (
              <li key={r.marketplace} className="flex flex-col items-center gap-2">
                <Link
                  href={dailyHref(day, active === r.marketplace ? null : r.marketplace)}
                  scroll={false}
                  aria-label={`${MARKETPLACE_LABELS[r.marketplace] ?? r.marketplace}: ${show(r[metric])}`}
                  aria-current={active === r.marketplace ? 'page' : undefined}
                  className="press group relative flex h-40 w-full max-w-14 items-end rounded-full bg-black/[0.045] md:h-44"
                >
                  {on && (
                    <span className="absolute -top-8 left-1/2 -translate-x-1/2 rounded-full bg-ink px-2 py-1 font-mono text-[11px] font-medium whitespace-nowrap text-white tabular-nums">
                      {show(r[metric])}
                    </span>
                  )}
                  <span
                    className={cn(
                      'block w-full rounded-full transition-[height] duration-500 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none',
                      on ? 'bg-[linear-gradient(180deg,#f0568c_0%,#8b5cf6_100%)]' : 'bg-[linear-gradient(180deg,#ffb27f_0%,#ff8f5a_100%)] group-hover:brightness-105',
                      active && !on && 'opacity-45',
                    )}
                    style={{ height: `${Math.max(share * 100, value(r) > 0 ? 12 : 0)}%` }}
                  />
                </Link>
                <span className={cn('text-xs', on ? 'font-semibold text-ink' : 'text-slate-500')}>{MARKETPLACE_LABELS[r.marketplace] ?? r.marketplace}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
