import type { Metadata } from 'next';
import Link from 'next/link';
import { scrubDeep, scrubProfitText, withoutProfitFigures } from '@/lib/analytics/redact';
import { Heatmap, hrefWith, Pills, SectionTitle } from '@/components/analytics/blocks';
import { MetricChart } from '@/components/analytics/charts';
import { formatBucket, formatValue } from '@/components/analytics/format';
import { Card, CardBody, EmptyState, td, th } from '@/components/ui';
import { buildAnalyticsSeries, buildHeatmap, METRIC_DEFINITIONS, type AnalyticsMetric } from '@/lib/analytics/analytics';
import { buildSeries } from '@/lib/analytics/metrics';
import { buildBusinessReview } from '@/lib/analytics/review';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { ViewFilters } from '../filters';
import { getT } from '@/lib/i18n/server';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Analytics · Business review') };
}

const METRICS: AnalyticsMetric[] = ['revenue', 'profit', 'margin', 'orders'];
const METRICS_WITHOUT_PROFIT = METRICS.filter((m) => m !== 'profit');
const TONE = { positive: 'border-l-emerald-500', negative: 'border-l-red-500', neutral: 'border-l-slate-300' } as const;
const PAGE = 31;

export default async function BusinessReviewPage({
  searchParams,
}: {
  searchParams: Promise<ViewParams & { metric?: string; heat?: string; page?: string }>;
}) {
  const t = await getT();
  await requireUser();
  const params = await searchParams;
  const view = await analyticsView(params);
  const { snapshot, period, data } = view;
  const metrics = view.showProfit ? METRICS : METRICS_WITHOUT_PROFIT;
  const metric = metrics.includes(params.metric as AnalyticsMetric) ? (params.metric as AnalyticsMetric) : 'revenue';
  const heat = params.heat === 'product' || params.heat === 'category' ? params.heat : 'brand';
  const current = { ...view.params, metric: params.metric, heat: params.heat };
  const link = (next: Record<string, string | undefined>) => hrefWith('/analytics/review', current, next);

  if (snapshot.isEmpty) {
    return (
      <>
        <ViewFilters view={view} path="/analytics/review" extra={current} />
        <Card>
          <EmptyState title={t('No orders in this period')} />
        </Card>
      </>
    );
  }

  const built = buildBusinessReview(view.fullSnapshot, data.coverage, view.showProfit);
  const review = view.showProfit
    ? built
    : { ...built, narrative: built.narrative.map((p) => scrubProfitText(p)).filter(Boolean), insights: withoutProfitFigures(built.insights.map((i) => scrubDeep(i))) };
  const series = buildAnalyticsSeries({ allOrders: data.orders, period, metric });
  const definition = METRIC_DEFINITIONS[metric];
  const daily = buildSeries(view.fullSnapshot.orders, 'day').reverse();
  const page = Math.max(1, Number(params.page) || 1);
  const pages = Math.max(1, Math.ceil(daily.length / PAGE));
  const heatmap = buildHeatmap(data.orders, heat, 'revenue');

  return (
    <div className="space-y-8">
      <ViewFilters view={view} path="/analytics/review" extra={current} />

      <section>
        <SectionTitle title={`${t('Business review')} · ${review.periodLabel}`} />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-6">
          {review.summary.map((s) => (
            <Card key={s.label} className="px-4 py-3">
              <p className="text-xs font-medium text-slate-500">{s.label}</p>
              <p className="mt-1 text-xl font-semibold tabular-nums text-slate-900">{s.value}</p>
              <p className="text-xs text-slate-500">{s.caption}</p>
            </Card>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Card>
          <CardBody className="space-y-3">
            <p className="text-sm font-semibold">{t('The period in words')}</p>
            {review.narrative.map((p) => (
              <p key={p} className="text-sm leading-relaxed text-slate-700">
                {p}
              </p>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2">
            <p className="text-sm font-semibold">{t('Observations')}</p>
            {review.insights.length === 0 && <p className="text-sm text-slate-500">{t('Nothing stands out in this period.')}</p>}
            {review.insights.map((i) => (
              <p key={i.statement} className={cn('border-l-4 pl-3 text-sm text-slate-700', TONE[i.tone])}>
                <span className="font-medium text-slate-900">{i.topic}: </span>
                {i.statement}
              </p>
            ))}
          </CardBody>
        </Card>
      </div>

      <section>
        <SectionTitle
          title={t('Trend')}
          description={definition.description}
          actions={
            <Pills
              label={t('Metric')}
              options={metrics.map((m) => ({ value: m, label: METRIC_DEFINITIONS[m].label }))}
              active={metric}
              href={(v) => link({ metric: v })}
            />
          }
        />
        <Card>
          <CardBody>
            <MetricChart
              data={series.points}
              format={definition.format}
              granularity={series.granularity}
              label={definition.label}
              overlays={{ previous: series.available.previous && period.previousCoverage === 'full', movingAverage: series.available.movingAverage }}
            />
          </CardBody>
        </Card>
      </section>

      <section>
        <SectionTitle
          title={t('Where revenue concentrates')}
          description={t('Revenue by month for the biggest rows; darker means more.')}
          actions={
            <Pills
              label={t('Rows')}
              options={[
                { value: 'brand', label: 'Brands' },
                { value: 'product', label: 'Products' },
                { value: 'category', label: 'Categories' },
              ]}
              active={heat}
              href={(v) => link({ heat: v })}
            />
          }
        />
        <Card>
          <CardBody>
            <Heatmap
              rows={heatmap.rows}
              columns={heatmap.columns}
              columnLabel={(c) => formatBucket(`${c}-01`, 'month', t.locale)}
              cells={heatmap.cells}
              format={(v) => formatValue(v, 'pln', true, t.locale)}
            />
          </CardBody>
        </Card>
      </section>

      <section>
        <SectionTitle title={t('Day by day')} />
        <Card className="overflow-x-auto">
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className={th}>{t('Date')}</th>
                <th className={cn(th, 'text-right')}>{t('Orders')}</th>
                <th className={cn(th, 'text-right')}>{t('Units')}</th>
                <th className={cn(th, 'text-right')}>{t('Revenue')}</th>
                {view.showProfit && <th className={cn(th, 'text-right')}>{t('Profit')}</th>}
                <th className={cn(th, 'text-right')}>{t('Margin')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {daily.slice((page - 1) * PAGE, page * PAGE).map((d) => (
                <tr key={d.date} className={d.orders === 0 ? 'text-slate-400' : undefined}>
                  <td className={td}>{formatBucket(d.date, 'day', t.locale)}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{d.orders}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{d.units}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{formatValue(d.revenuePLN, 'pln', false, t.locale)}</td>
                  {view.showProfit && <td className={cn(td, 'text-right tabular-nums', d.marginPLN < 0 && 'text-red-700')}>{formatValue(d.marginPLN, 'pln', false, t.locale)}</td>}
                  <td className={cn(td, 'text-right tabular-nums')}>{d.orders ? formatValue(d.marginPct, 'percent', false, t.locale) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {pages > 1 && (
            <div className="flex justify-end gap-2 border-t border-slate-100 px-4 py-2 text-sm">
              {page > 1 && <Link href={link({ page: String(page - 1) })}>{t('← Newer')}</Link>}
              <span className="text-slate-500">
                {t('Page {page} of {pages}', { page, pages })}
              </span>
              {page < pages && <Link href={link({ page: String(page + 1) })}>{t('Older →')}</Link>}
            </div>
          )}
        </Card>
      </section>
    </div>
  );
}
