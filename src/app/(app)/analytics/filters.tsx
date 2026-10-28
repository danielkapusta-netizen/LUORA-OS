import { hrefWith, Pills } from '@/components/analytics/blocks';
import { PeriodControl } from '@/components/analytics/period-control';
import { formatDate } from '@/lib/analytics/format';
import type { AnalyticsView } from '@/server/analytics/view';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

const MARKETPLACES = [
  { value: '', label: msg('All marketplaces') },
  { value: 'shopify', label: 'Shopify' },
  { value: 'allegro', label: 'Allegro' },
  { value: 'empik', label: 'Empik' },
  { value: 'vonhalsky', label: 'Von Halsky' },
  { value: 'hebe', label: 'HEBE' },
];

/** Period and marketplace pills shared by the analytics tabs, plus the dates they cover. */
export async function ViewFilters({ view, path, extra = {} }: { view: AnalyticsView; path: string; extra?: Record<string, string | undefined> }) {
  const t = await getT();
  const current = { ...view.params, ...extra };
  const { period } = view;
  return (
    <div className="mb-5 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <PeriodControl path={path} current={current} periodKey={view.periodKey} from={view.params.from} to={view.params.to} />
        <Pills label={t('Marketplace')} options={MARKETPLACES} active={view.marketplace ?? ''} href={(v) => hrefWith(path, current, { marketplace: v || undefined })} />
      </div>
      <p className="text-xs text-slate-500">
        {period.key === 'all' ? t('All time') : `${formatDate(period.from, t.locale)} – ${formatDate(period.to, t.locale)}`}
        {period.previous && `, ${t('compared {label}', { label: period.comparisonLabel })}`}
      </p>
    </div>
  );
}
