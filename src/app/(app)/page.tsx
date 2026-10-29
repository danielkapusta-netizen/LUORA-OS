import { Lightbulb, Package, ShieldAlert, Sparkles, Store, Users } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BriefCard, ChannelBars, CoverageNote, hrefWith, KpiCard, Pills, SectionTitle } from '@/components/analytics/blocks';
import { PeriodControl } from '@/components/analytics/period-control';
import { PulseChart } from '@/components/analytics/lazy-charts';
import { formatValue } from '@/components/analytics/format';
import { Card, CardBody, CardHeader, EmptyState, ListRow, PanelLink } from '@/components/ui';
import { buildExecutiveBrief } from '@/lib/analytics/brief';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { labelReadyCount, statusCounts } from '@/server/services/orders';
import { allCustomers, orderDatesByCustomer } from '@/server/services/customers';
import { listTasks } from '@/server/services/tasks';
import { TASK_LIMIT } from '@/components/tasks/my-tasks-heading';
import { today as warsawToday } from '@/lib/tasks/dates';
import { overdueCustomers, repeatStats } from '@/lib/crm/segments';
import { LogisticsDashboard } from './logistics-dashboard';
import { Greeting, OpenOrderTiles, TasksPanel } from './dashboard-parts';
import { getT } from '@/lib/i18n/server';
import { comparisonText } from '@/lib/analytics/period';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Dashboard') };
}

export default async function DashboardPage({ searchParams }: { searchParams: Promise<ViewParams & { rank?: string; pulse?: string }> }) {
  const t = await getT();
  const user = await requireUser();
  if (!can(user.role, 'fullDashboard')) return <LogisticsDashboard user={user} />;
  const params = await searchParams;
  const [view, counts, labelReady, tasks, customerList, dates] = await Promise.all([analyticsView(params), statusCounts(), labelReadyCount(), listTasks({ assignee: user.id, status: 'open', limit: TASK_LIMIT }), allCustomers(), orderDatesByCustomer()]);
  const todayKey = warsawToday();
  const firstName = user.name.split(' ')[0];
  const repeat = repeatStats(customerList, dates);
  const byCustomer = new Map(customerList.map((c) => [c.id, c]));
  const quietRegulars = overdueCustomers(dates).filter((o) => byCustomer.get(o.id));
  const { snapshot, period, data, showProfit } = view;
  const brief = buildExecutiveBrief(snapshot, firstName, new Date(), showProfit);
  const rank = showProfit && params.rank === 'profit' ? 'profit' : 'revenue';
  const pulse = params.pulse === 'orders' ? 'orders' : 'money';
  const current = { ...view.params, rank: params.rank, pulse: params.pulse };
  // Choosing a period always drops custom dates: with both present, the dates would win and the link would do nothing.
  const link = (next: Record<string, string | undefined>) => hrefWith('/', current, next.period ? { from: undefined, to: undefined, ...next } : next);
  // The two biggest risks and the best opportunity; the rest, with Questions and Health, live in Analytics.
  const insights = [...snapshot.insights.filter((i) => i.kind === 'risk').slice(0, 2), ...snapshot.insights.filter((i) => i.kind === 'opportunity').slice(0, 1)];
  const atStake = snapshot.insights.reduce((sum, i) => sum + (i.impactPLN ?? 0), 0);
  const top = [...snapshot.products].sort((a, b) => (rank === 'profit' ? b.marginPLN - a.marginPLN : b.revenuePLN - a.revenuePLN)).slice(0, 5);
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
      <Greeting name={firstName} actions={<PeriodControl path="/" current={current} periodKey={view.periodKey} from={view.params.from} to={view.params.to} />} />

      <OpenOrderTiles counts={counts} labelReady={labelReady} />

      {data.lineItems.length === 0 || snapshot.isEmpty ? (
        <>
          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-2">
            <TasksPanel tasks={tasks} today={todayKey} limit={TASK_LIMIT} />
            {customers}
          </div>
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
        </>
      ) : (
        <>
          <BriefCard brief={brief} atStake={atStake} />

          <section>
            <SectionTitle
              title={t('Summary')}
              description={`${t('{orders} from {customers}.', { orders: t.plural(snapshot.totals.orders, '{n} order', '{n} orders'), customers: t.plural(snapshot.totals.customers, '{n} customer', '{n} customers') })} ${showProfit ? t('Profit is after VAT, fees, product cost, shipping and refunds.') : t('Margin is after VAT, fees, product cost, shipping and refunds.')}`}
            />
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-5">
              {snapshot.kpis.map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} comparisonLabel={comparisonText(period, t)} granularity={period.granularity} />
              ))}
            </div>
          </section>

          <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] md:gap-5">
            <div className="space-y-4 md:space-y-5">
              <Card tone="sky">
                <CardHeader
                  icon={Package}
                  title={t('Top products')}
                  count={snapshot.products.length}
                  actions={
                    <>
                      {showProfit && (
                        <Pills
                          label={t('Rank products by')}
                          options={[
                            { value: 'revenue', label: 'Revenue' },
                            { value: 'profit', label: 'Profit' },
                          ]}
                          active={rank}
                          href={(v) => link({ rank: v })}
                        />
                      )}
                      <PanelLink href={hrefWith('/analytics/products', view.params, {})}>{t('View all')}</PanelLink>
                    </>
                  }
                />
                <CardBody className="space-y-2 pt-3 pb-5">
                  {top.map((p) => (
                    <ListRow
                      key={p.productKey}
                      href={productHref(p.productKey)}
                      icon={<Package className="size-4" aria-hidden />}
                      title={p.label}
                      subtitle={`${p.brand ? `${p.brand} · ` : ''}${t.plural(p.units, '{n} unit', '{n} units')}${p.costUnknown ? ` · ${t('cost missing')}` : ''}`}
                      trailing={
                        <span className="block text-right">
                          <span className="block text-sm font-medium tabular-nums">{pln(rank === 'profit' ? p.marginPLN : p.revenuePLN)}</span>
                          <span className={cn('block text-xs tabular-nums text-slate-500', p.marginPLN < 0 && 'text-red-700')}>
                            {t('margin {value}', { value: formatValue(p.marginPct, 'percent', false, t.locale) })}
                          </span>
                        </span>
                      }
                    />
                  ))}
                </CardBody>
              </Card>

              <Card>
                <CardHeader
                  title={t('Business pulse')}
                  description={period.granularity === 'month' ? t('By month; quiet months show as zero.') : period.granularity === 'week' ? t('By week; quiet weeks show as zero.') : t('By day; quiet days show as zero.')}
                  actions={
                    <Pills
                      label={t('Pulse metric')}
                      options={[
                        { value: 'money', label: showProfit ? t('Revenue & profit') : t('Revenue') },
                        { value: 'orders', label: t('Orders') },
                      ]}
                      active={pulse}
                      href={(v) => link({ pulse: v })}
                    />
                  }
                />
                <CardBody className="pb-5">
                  <PulseChart
                    metric={pulse}
                    granularity={period.granularity}
                    showProfit={showProfit}
                    data={snapshot.series.map((p) => ({ date: p.date, revenue: Math.round(p.revenuePLN), profit: Math.round(p.marginPLN), orders: p.orders }))}
                  />
                </CardBody>
              </Card>
            </div>

            <div className="space-y-4 md:space-y-5">
              <TasksPanel tasks={tasks} today={todayKey} limit={TASK_LIMIT} />
              {customers}
              <Card>
                <CardHeader icon={Store} title={t('Where you sell')} />
                <CardBody className="pt-4 pb-5">
                  <ChannelBars channels={snapshot.channels} />
                </CardBody>
              </Card>
            </div>
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
    </div>
  );
}
