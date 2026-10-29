// The time picker of the Dashboard, the Analytics tabs and Inventory: preset pills, and a "Custom" button that opens two dates.
import Link from 'next/link';
import { Input } from '@/components/ui';
import type { PeriodKey } from '@/lib/analytics/period';
import { cn } from '@/lib/utils';
import { hrefWith } from './blocks';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';
import { intlTag, type Locale } from '@/lib/i18n/locales';

export const PERIOD_PRESETS: { value: PeriodKey; label: string }[] = [
  { value: 'week', label: msg('Week') },
  { value: 'lastweek', label: msg('Last week') },
  { value: 'month', label: msg('Month') },
  { value: 'quarter', label: msg('Quarter') },
  { value: 'year', label: msg('Year') },
  { value: 'all', label: msg('All time') },
];

const pill = 'rounded-full px-3 py-1 text-xs font-medium whitespace-nowrap max-md:py-2 max-md:text-sm';

function shortDay(day: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
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
  help,
  label,
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
  const helpText = help ?? t('Both days are included.');
  const labelText = label ?? t('Period');
  const drop = [param, 'from', 'to', ...reset];
  const kept = Object.entries(current).filter(([k, v]) => v && !drop.includes(k)) as [string, string][];
  const cleared = Object.fromEntries(reset.map((k) => [k, undefined]));
  return (
    <div className="relative inline-block">
      <nav aria-label={labelText} className="inline-flex flex-wrap items-center gap-0.5 rounded-full bg-black/[0.04] p-1 max-md:rounded-3xl">
        {presets.map((o) => (
          <Link
            key={o.value}
            href={hrefWith(path, current, { ...cleared, [param]: o.value, from: undefined, to: undefined })}
            aria-current={!custom && o.value === active ? 'true' : undefined}
            className={cn(pill, !custom && o.value === active ? 'bg-white text-ink shadow-[0_1px_2px_rgba(28,27,25,0.08)]' : 'text-slate-600 hover:text-ink')}
          >
            {t(o.label)}
          </Link>
        ))}
        <details>
          <summary
            className={cn(pill, 'cursor-pointer list-none', custom ? 'bg-white text-ink shadow-[0_1px_2px_rgba(28,27,25,0.08)]' : 'text-slate-600 hover:text-ink')}
            aria-label={custom ? t('Custom range: {from} to {to}', { from: shortDay(custom.from, t.locale), to: shortDay(custom.to, t.locale) }) : t('Custom range')}
          >
            {custom ? `${shortDay(custom.from, t.locale)} – ${shortDay(custom.to, t.locale)}` : t('Custom')}
          </summary>
          <form action={path} className="absolute left-0 z-20 mt-2 w-[min(92vw,22rem)] space-y-3 rounded-3xl border border-black/[0.06] bg-white p-4 text-ink shadow-[0_16px_40px_-16px_rgba(28,27,25,0.25)]">
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
            <p className="text-xs text-slate-500">{helpText}</p>
            <button className="inline-flex h-9 w-full items-center justify-center rounded-full bg-brand-600 text-sm font-medium text-white hover:bg-brand-700 max-md:h-11">{t('Show these dates')}</button>
          </form>
        </details>
      </nav>
    </div>
  );
}

/** The period picker of the Dashboard and the Analytics tabs, driven by the `period` parameter. */
export async function PeriodControl({
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
  const t = await getT();
  const custom = periodKey === 'custom' && from && to ? { from, to } : undefined;
  return <RangeControl path={path} current={current} presets={PERIOD_PRESETS} active={periodKey} custom={custom} help={t('Both days are included, and compared with the same number of days just before.')} />;
}
