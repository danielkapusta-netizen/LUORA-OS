// The time picker of the Dashboard, the Analytics tabs and Inventory: preset pills, and a "Custom" button that opens two dates.
import Link from 'next/link';
import { Input } from '@/components/ui';
import type { PeriodKey } from '@/lib/analytics/period';
import { cn } from '@/lib/utils';
import { hrefWith } from './blocks';
import { getT } from '@/lib/i18n/server';

export const PERIOD_PRESETS: { value: PeriodKey; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'lastweek', label: 'Last week' },
  { value: 'month', label: 'Month' },
  { value: 'quarter', label: 'Quarter' },
  { value: 'year', label: 'Year' },
  { value: 'all', label: 'All time' },
];

const pill = 'rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap max-md:py-2 max-md:text-sm';

function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * `current` is every query parameter of the page (marketplace, sorting, ...). Choosing a preset sets `param` and drops any
 * custom dates; applying custom dates sets `from`/`to` and drops the preset. Parameters in `reset` (a page number)
 * are dropped on either, since they no longer mean the same thing.
 */
export async function RangeControl({
  path,
  current,
  presets,
  active,
  param = 'period',
  custom,
  reset = [],
  help = 'Both days are included.',
  label = 'Period',
}: {
  path: string;
  current: Record<string, string | undefined>;
  presets: { value: string; label: string }[];
  /** The preset in force; ignored while `custom` is set. */
  active: string;
  /** The query parameter that carries the preset. */
  param?: string;
  /** The custom range in force, `YYYY-MM-DD`. */
  custom?: { from: string; to: string };
  reset?: string[];
  help?: string;
  label?: string;
}) {
  const t = await getT();
  const drop = [param, 'from', 'to', ...reset];
  const kept = Object.entries(current).filter(([k, v]) => v && !drop.includes(k)) as [string, string][];
  const cleared = Object.fromEntries(reset.map((k) => [k, undefined]));
  return (
    <div className="relative inline-block">
      <nav aria-label={label} className="inline-flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
        {presets.map((o) => (
          <Link
            key={o.value}
            href={hrefWith(path, current, { ...cleared, [param]: o.value, from: undefined, to: undefined })}
            aria-current={!custom && o.value === active ? 'true' : undefined}
            className={cn(pill, !custom && o.value === active ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
          >
            {o.label}
          </Link>
        ))}
        <details>
          <summary
            className={cn(pill, 'cursor-pointer list-none', custom ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
            aria-label={custom ? `Custom range: ${shortDay(custom.from)} to ${shortDay(custom.to)}` : 'Custom range'}
          >
            {custom ? `${shortDay(custom.from)} – ${shortDay(custom.to)}` : 'Custom'}
          </summary>
          <form action={path} className="absolute left-0 z-20 mt-2 w-[min(92vw,22rem)] space-y-3 rounded-2xl border border-black/5 bg-white p-4 text-slate-900 shadow-lg">
            {kept.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">{t('From')}</span>
                <Input type="date" name="from" defaultValue={custom?.from} required />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">{t('To')}</span>
                <Input type="date" name="to" defaultValue={custom?.to} required />
              </label>
            </div>
            <p className="text-xs text-slate-500">{help}</p>
            <button className="inline-flex h-9 w-full items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white hover:bg-brand-700 max-md:h-11">{t('Show these dates')}</button>
          </form>
        </details>
      </nav>
    </div>
  );
}

/** The period picker of the Dashboard and the Analytics tabs, driven by the `period` parameter. */
export function PeriodControl({
  path,
  current,
  periodKey,
  from,
  to,
}: {
  path: string;
  current: Record<string, string | undefined>;
  periodKey: PeriodKey;
  /** The custom range in force, `YYYY-MM-DD`. */
  from?: string;
  to?: string;
}) {
  const custom = periodKey === 'custom' && from && to ? { from, to } : undefined;
  return <RangeControl path={path} current={current} presets={PERIOD_PRESETS} active={periodKey} custom={custom} help="Both days are included, and compared with the same number of days just before." />;
}
