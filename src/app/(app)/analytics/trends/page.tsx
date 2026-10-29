import type { Metadata } from 'next';
import Link from 'next/link';
import { Delta, hrefWith, Pills, SectionTitle } from '@/components/analytics/blocks';
import { MetricChart, WeekdayBars } from '@/components/analytics/charts';
import { formatValue } from '@/components/analytics/format';
import { Card, CardBody, EmptyState } from '@/components/ui';
import { availableGranularities, buildAnalyticsSeries, METRIC_DEFINITIONS, METRIC_ORDER, type AnalyticsMetric, type OverlayKey } from '@/lib/analytics/analytics';
import { comparisonText, isWithin } from '@/lib/analytics/period';
import { buildWeekdayPattern } from '@/lib/analytics/trends';
import type { Granularity } from '@/lib/analytics/types';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { ViewFilters } from '../filters';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Analytics · Trends') };
}

const OVERLAYS: { key: OverlayKey; label: string }[] = [
  { key: 'previous', label: msg('Previous period') },
  { key: 'lastYear', label: msg('Last year') },
  { key: 'movingAverage', label: msg('Moving average') },
  { key: 'forecast', label: msg('Projection') },
];
const GRAINS: Record<Granularity, string> = { day: msg('Daily'), week: msg('Weekly'), month: msg('Monthly'), quarter: msg('Quarterly'), year: msg('Yearly') };

type Params = ViewParams & { metric?: string; grain?: string; show?: string };

export default async function TrendsPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await getT();
  await requireUser();
  const params = await searchParams;
  const view = await analyticsView(params, 'quarter');
  const { period, data } = view;
  const metrics = view.showProfit ? METRIC_ORDER : METRIC_ORDER.filter((m) => m !== 'profit' && m !== 'contribution');
  const metric = metrics.includes(params.metric as AnalyticsMetric) ? (params.metric as AnalyticsMetric) : 'revenue';
  const grains = availableGranularities(period);
  const grain = grains.includes(params.grain as Granularity) ? (params.grain as Granularity) : period.granularity;
  // Overlays are on unless switched off: "show" lists the ones that are on.
  const shown = new Set((params.show ?? 'previous,movingAverage').split(',').filter(Boolean) as OverlayKey[]);
  const current = { ...view.params, metric: params.metric, grain: params.grain, show: params.show };
  const link = (next: Record<string, string | undefined>) => hrefWith('/analytics/trends', current, next);
  const toggle = (key: OverlayKey) => {
    const next = new Set(shown);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return link({ show: [...next].join(',') || 'none' });
  };

  const series = buildAnalyticsSeries({ allOrders: data.orders, period, metric, granularity: grain, forecastSteps: shown.has('forecast') ? 3 : 0 });
  const definition = METRIC_DEFINITIONS[metric];
  const weekdays = buildWeekdayPattern(data.daily.filter((d) => isWithin(new Date(`${d.date}T12:00:00Z`), period.from, period.to)));

  return (
    <div className="space-y-6">
      <ViewFilters view={view} path="/analytics/trends" extra={current} />
      <div className="flex flex-wrap items-center gap-2">
        <Pills label={t('Metric')} options={metrics.map((m) => ({ value: m, label: t(METRIC_DEFINITIONS[m].label) }))} active={metric} href={(v) => link({ metric: v })} />
        <Pills label={t('Grain')} options={grains.map((g) => ({ value: g, label: GRAINS[g] }))} active={grain} href={(v) => link({ grain: v })} />
      </div>
      {view.snapshot.isEmpty ? (
        <Card>
          <EmptyState title={t('No orders in this period')} />
        </Card>
      ) : (
        <>
          <Card>
            <CardBody className="space-y-4">
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{t(definition.label)}</p>
                  <p className="text-3xl font-semibold tabular-nums">{formatValue(series.total, definition.format, false, t.locale)}</p>
                  <div className="flex items-center gap-2">
                    <Delta value={series.changePct} unit={definition.format === 'percent' ? 'pp' : '%'} higherIsBetter={definition.higherIsBetter} />
                    <span className="text-xs text-slate-400">{comparisonText(period, t)}</span>
                    {series.projectedTotal !== null && shown.has('forecast') && (
                      <span className="text-xs text-slate-500">· {t('projected {value}', { value: formatValue(series.projectedTotal, definition.format, false, t.locale) })}</span>
                    )}
                  </div>
                  <p className="mt-1 max-w-xl text-xs text-slate-500">{t(definition.description)}</p>
                </div>
                <div className="flex flex-wrap gap-1.5" role="group" aria-label={t('Overlays')}>
                  {OVERLAYS.map((o) => {
                    // A previous window before trading began would show a false collapse.
                    const available = series.available[o.key] && (o.key !== 'previous' || period.previousCoverage === 'full');
                    const on = shown.has(o.key) && available;
                    return available ? (
                      <Link
                        key={o.key}
                        href={toggle(o.key)}
                        aria-pressed={on}
                        className={cn('rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-slate-900 bg-slate-900 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50')}
                      >
                        {t(o.label)}
                      </Link>
                    ) : (
                      <span key={o.key} className="rounded-full border border-dashed border-slate-200 px-3 py-1 text-xs text-slate-400" title={t('Not enough history')}>
                        {t(o.label)}
                      </span>
                    );
                  })}
                </div>
              </div>
              <MetricChart
                data={series.points}
                format={definition.format}
                granularity={series.granularity}
                label={t(definition.label)}
                overlays={{
                  previous: shown.has('previous') && series.available.previous && period.previousCoverage === 'full',
                  lastYear: shown.has('lastYear') && series.available.lastYear,
                  movingAverage: shown.has('movingAverage') && series.available.movingAverage,
                  forecast: shown.has('forecast') && series.available.forecast,
                }}
              />
            </CardBody>
          </Card>
          <section>
            <SectionTitle title={t('Weekday rhythm')} description={t('Average revenue per weekday in this period, so a range with two Mondays and one Sunday compares fairly.')} />
            <Card>
              <CardBody>
                <WeekdayBars data={weekdays.map((w) => ({ label: t(w.label), value: Math.round(w.avgRevenuePLN) }))} />
              </CardBody>
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
