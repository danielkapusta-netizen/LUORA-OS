import { Lightbulb, ShieldAlert, Sparkles, Store, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ChannelBars, CoverageNote, hrefWith, KpiCard, SectionTitle } from '@/components/analytics/blocks';
import { PeriodControl } from '@/components/analytics/period-control';
import { formatValue } from '@/components/analytics/format';
import { Card, CardBody, CardHeader, EmptyState, ListRow, PanelLink } from '@/components/ui';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, todaySnapshot, type ViewParams } from '@/server/analytics/view';
import { pickList, statusCounts } from '@/server/services/orders';
import { allCustomers, orderDatesByCustomer } from '@/server/services/customers';
import { listTasks } from '@/server/services/tasks';
import { TASK_LIMIT } from '@/components/tasks/my-tasks-heading';
import { today as warsawToday } from '@/lib/tasks/dates';
import { overdueCustomers, repeatStats } from '@/lib/crm/segments';
import { LogisticsDashboard } from './logistics-dashboard';
import { Greeting, PickRow, TasksPanel, TodayCard } from './dashboard-parts';
import { PulseCard } from './pulse-card';
import { TopProductsCard, type TopProduct } from './top-products-card';
import { getT } from '@/lib/i18n/server';
import { comparisonText } from '@/lib/analytics/period';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Dashboard') };
}

/**
 * Today first (new orders with my tasks under them, what to pick, today's sales), then the chosen period: its summary, pulse,
 * channels, top products, customers and insights.
 */
export default async function DashboardPage({ searchParams }: { searchParams: Promise<ViewParams> }) {
  const t = await getT();
  const user = await requireUser();
  if (!can(user.role, 'fullDashboard')) return <LogisticsDashboard user={user} />;
  const params = await searchParams;
  const [view, counts, pick, tasks, customerList, dates] = await Promise.all([
    analyticsView(params),
    statusCounts(),
    pickList(),
    listTasks({ assignee: user.id, status: 'open', limit: TASK_LIMIT }),
    allCustomers(),
    orderDatesByCustomer(),
  ]);
  const today = await todaySnapshot(view);
  const todayKey = warsawToday();
  const firstName = user.name.split(' ')[0];
  const repeat = repeatStats(customerList, dates);
  const byCustomer = new Map(customerList.map((c) => [c.id, c]));
  const quietRegulars = overdueCustomers(dates).filter((o) => byCustomer.get(o.id));
  const { snapshot, period, data, showProfit } = view;
  const link = (next: Record<string, string | undefined>) => hrefWith('/', view.params, next.period ? { from: undefined, to: undefined, ...next } : next);
  // The two biggest risks and the best opportunity; the rest, with Questions and Health, live in Analytics.
  const insights = [...snapshot.insights.filter((i) => i.kind === 'risk').slice(0, 2), ...snapshot.insights.filter((i) => i.kind === 'opportunity').slice(0, 1)];
  const toTop = (list: typeof snapshot.products): TopProduct[] =>
    list.slice(0, 5).map((p) => ({ key: p.productKey, label: p.label, brand: p.brand, units: p.units, revenuePLN: p.revenuePLN, marginPLN: p.marginPLN, marginPct: p.marginPct, costUnknown: p.costUnknown }));
  const byRevenue = toTop([...snapshot.products].sort((a, b) => b.revenuePLN - a.revenuePLN));
  const byProfit = showProfit ? toTop([...snapshot.products].sort((a, b) => b.marginPLN - a.marginPLN)) : null;
  const productHref = (key: string) => `/analytics/products?open=${encodeURIComponent(key)}`;
  const pln = (v: number) => formatValue(v, 'pln', false, t.locale);

  const customers = repeat.customers > 0 && (
    <Card tone="blush">
      <CardHeader icon={Users} title={t('Customers')} actions={<PanelLink href="/customers/segments">{t('View all')}</PanelLink>} />
      <CardBody className="grid grid-cols-2 gap-2 pt-3 pb-5">
        <Link href="/customers/segments" className="rounded-2xl border border-black/[0.04] bg-white/90 px-4 py-3 transition-colors hover:bg-white">
          <span className="block text-xs text-slate-500">{t('Customers who came back')}</span>
          <span className="mt-1 block font-mono text-2xl font-medium tabular-nums">{Math.round(repeat.repeatRate * 100)}%</span>
          <span className="mt-0.5 block text-xs text-slate-500">{t('{n} of {total} customers ordered again', { n: repeat.repeatCustomers, total: repeat.customers })}</span>
        </Link>
        <Link href="/customers/segments" className="rounded-2xl border border-black/[0.04] bg-white/90 px-4 py-3 transition-colors hover:bg-white">
          <span className="block text-xs text-slate-500">{t('Regulars gone quiet')}</span>
          <span className={cn('mt-1 block font-mono text-2xl font-medium tabular-nums', quietRegulars.length > 0 && 'text-blush-ink')}>{quietRegulars.length}</span>
          <span className="mt-0.5 block text-xs text-slate-500">{t('over twice their usual gap since the last order')}</span>
        </Link>
      </CardBody>
    </Card>
  );

  return (
    <div className="space-y-6 md:space-y-8">
      <Greeting name={firstName} />

      {/* My tasks fill the space under the New tile, beside the pick list; today's sales follow at full width. */}
      <PickRow newOrders={counts.new ?? 0} lines={pick} aside={<TasksPanel tasks={tasks} today={todayKey} limit={TASK_LIMIT} />} />

      <TodayCard snapshot={today} showProfit={showProfit} />

      <section className="space-y-4 border-t border-black/[0.06] pt-6 md:space-y-5 md:pt-8">
        <SectionTitle
          title={t('Performance')}
          description={
            data.lineItems.length && !snapshot.isEmpty
              ? `${t('{orders} from {customers}.', { orders: t.plural(snapshot.totals.orders, '{n} order', '{n} orders'), customers: t.plural(snapshot.totals.customers, '{n} customer', '{n} customers') })} ${showProfit ? t('Profit is after VAT, fees, product cost, shipping and refunds.') : t('Margin is after VAT, fees, product cost, shipping and refunds.')}`
              : undefined
          }
          actions={<PeriodControl path="/" current={view.params} periodKey={view.periodKey} from={view.params.from} to={view.params.to} />}
        />

        {data.lineItems.length === 0 || snapshot.isEmpty ? (
          <>
            <Card>
              {data.lineItems.length === 0 ? (
                <EmptyState title={t('No sales to analyse yet')}>
                  {t('Orders appear here once they sync. For your history, use “Import past orders” on each account in')}{' '}
                  <Link href="/settings/integrations" className="underline">
                    {t('Settings → Integrations')}
                  </Link>
                  {t(', and add product costs in')}{' '}
                  <Link href="/settings/costs" className="underline">
                    {t('Costs & margins')}
                  </Link>
                  .
                </EmptyState>
              ) : (
                <EmptyState title={t('No orders in this period')}>
                  <Link href={link({ period: 'all' })} className="underline">
                    {t('Show all time')}
                  </Link>
                </EmptyState>
              )}
            </Card>
            {customers}
          </>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              {snapshot.kpis.map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} comparisonLabel={comparisonText(period, t)} granularity={period.granularity} />
              ))}
            </div>

            <div className="grid grid-cols-1 items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <PulseCard
                granularity={period.granularity}
                showProfit={showProfit}
                data={snapshot.series.map((p) => ({ date: p.date, revenue: Math.round(p.revenuePLN), profit: Math.round(p.marginPLN), orders: p.orders }))}
              />
              <Card>
                <CardHeader icon={Store} title={t('Where you sell')} />
                <CardBody className="pt-4 pb-5">
                  <ChannelBars channels={snapshot.channels} />
                </CardBody>
              </Card>
            </div>

            <div className="grid grid-cols-1 items-start gap-4 md:gap-5 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
              <TopProductsCard byRevenue={byRevenue} byProfit={byProfit} total={snapshot.products.length} viewAllHref={hrefWith('/analytics/products', view.params, {})} />
              {customers}
            </div>

            <Card tone="peach">
              <CardHeader
                icon={Sparkles}
                title={t('Insights')}
                count={snapshot.insights.length}
                actions={<PanelLink href={hrefWith('/analytics/actions', view.params, {})}>{t('All findings →')}</PanelLink>}
              />
              <CardBody className="grid grid-cols-1 gap-2 pt-3 pb-5 md:grid-cols-3">
                {insights.length ? (
                  insights.map((i) => (
                    <ListRow
                      key={i.id}
                      href={i.entity?.type === 'product' ? productHref(i.entity.key) : hrefWith('/analytics/actions', view.params, {})}
                      icon={i.kind === 'risk' ? <ShieldAlert className="size-4 text-red-700" aria-label={t('Risk')} /> : <Lightbulb className="size-4 text-emerald-700" aria-label={t('Opportunity')} />}
                      title={i.title}
                      wrap
                      subtitle={i.impactPLN !== null ? `${pln(i.impactPLN)} ${i.impactLabel ?? ''}` : i.action}
                    />
                  ))
                ) : (
                  <p className="rounded-2xl bg-white/70 px-4 py-6 text-center text-sm text-slate-500 md:col-span-3">{showProfit ? t('No profit risks detected') : t('No margin risks detected')}</p>
                )}
              </CardBody>
            </Card>

            <CoverageNote
              costCoverage={data.coverage.costCoverage}
              estimatedFeeLines={data.estimatedFeeLines}
              totalLines={data.lineItems.length}
              lastOrder={data.coverage.lastOrder}
            />
          </>
        )}
      </section>
    </div>
  );
}
