import { hrefWith, PERIOD_OPTIONS, Pills } from '@/components/analytics/blocks';
import { formatDate } from '@/lib/analytics/format';
import type { AnalyticsView } from '@/server/analytics/view';

const MARKETPLACES = [
  { value: '', label: 'All marketplaces' },
  { value: 'shopify', label: 'Shopify' },
  { value: 'allegro', label: 'Allegro' },
  { value: 'empik', label: 'Empik' },
  { value: 'vonhalsky', label: 'Von Halsky' },
];

/** Period and marketplace pills shared by the analytics tabs, plus the dates they cover. */
export function ViewFilters({ view, path, extra = {} }: { view: AnalyticsView; path: string; extra?: Record<string, string | undefined> }) {
  const current = { ...view.params, ...extra };
  const { period } = view;
  return (
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <Pills label="Period" options={PERIOD_OPTIONS} active={view.periodKey} href={(v) => hrefWith(path, current, { period: v, from: undefined, to: undefined })} />
        <Pills label="Marketplace" options={MARKETPLACES} active={view.marketplace ?? ''} href={(v) => hrefWith(path, current, { marketplace: v || undefined })} />
      </div>
      <p className="text-xs text-slate-500">
        {period.key === 'all' ? 'All time' : `${formatDate(period.from)} – ${formatDate(period.to)}`}
        {period.previous && `, compared ${period.comparisonLabel}`}
      </p>
    </div>
  );
}
