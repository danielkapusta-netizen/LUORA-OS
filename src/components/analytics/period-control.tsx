// The period picker of the Dashboard and the Analytics tabs: preset pills, and a "Custom" button that opens two dates.
import Link from 'next/link';
import { Input } from '@/components/ui';
import type { PeriodKey } from '@/lib/analytics/period';
import { cn } from '@/lib/utils';
import { hrefWith } from './blocks';

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
 * `current` is every query parameter of the page (marketplace, sorting, ...); choosing a preset keeps them and drops any
 * custom dates, and applying custom dates keeps them and drops the preset.
 */
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
  const custom = periodKey === 'custom' && Boolean(from && to);
  const kept = Object.entries(current).filter(([k, v]) => v && !['period', 'from', 'to'].includes(k)) as [string, string][];
  return (
    <div className="relative inline-block">
      <nav aria-label="Period" className="inline-flex flex-wrap items-center gap-1 rounded-full border border-slate-200 bg-white p-1">
        {PERIOD_PRESETS.map((o) => (
          <Link
            key={o.value}
            href={hrefWith(path, current, { period: o.value, from: undefined, to: undefined })}
            aria-current={o.value === periodKey ? 'true' : undefined}
            className={cn(pill, o.value === periodKey ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
          >
            {o.label}
          </Link>
        ))}
        <details>
          <summary
            className={cn(pill, 'cursor-pointer list-none', custom ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100')}
            aria-label={custom ? `Custom range: ${shortDay(from!)} to ${shortDay(to!)}` : 'Custom range'}
          >
            {custom ? `${shortDay(from!)} – ${shortDay(to!)}` : 'Custom'}
          </summary>
          <form action={path} className="absolute left-0 z-20 mt-2 w-[min(92vw,22rem)] space-y-3 rounded-2xl border border-black/5 bg-white p-4 text-slate-900 shadow-lg">
            {kept.map(([k, v]) => (
              <input key={k} type="hidden" name={k} value={v} />
            ))}
            <div className="grid grid-cols-2 gap-3">
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">From</span>
                <Input type="date" name="from" defaultValue={from} required />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-slate-600">To</span>
                <Input type="date" name="to" defaultValue={to} required />
              </label>
            </div>
            <p className="text-xs text-slate-500">Both days are included, and compared with the same number of days just before.</p>
            <button className="inline-flex h-9 w-full items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white hover:bg-brand-700 max-md:h-11">Show these dates</button>
          </form>
        </details>
      </nav>
    </div>
  );
}
