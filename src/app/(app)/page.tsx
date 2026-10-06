import { CheckCircle2, ShieldAlert, TrendingUp } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BriefCard, ChannelBars, CoverageNote, HealthCard, hrefWith, InsightCard, KpiCard, PERIOD_OPTIONS, Pills, QuestionCard, SectionTitle } from '@/components/analytics/blocks';
import { PulseChart } from '@/components/analytics/charts';
import { formatValue } from '@/components/analytics/format';
import { buttonClass, Card, CardBody, EmptyState, PageHeader, td, th } from '@/components/ui';
import { buildExecutiveBrief } from '@/lib/analytics/brief';
import { formatDate } from '@/lib/analytics/format';
import { buildExecutiveQuestions } from '@/lib/analytics/questions';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { statusCounts } from '@/server/services/orders';
import { allCustomers, openTasks, orderDatesByCustomer } from '@/server/services/customers';
import { overdueCustomers, repeatStats } from '@/lib/crm/segments';

export const metadata: Metadata = { title: 'Dashboard' };

const OPEN = [
  { status: 'new', label: 'New' },
  { status: 'processing', label: 'Processing' },
  { status: 'label_created', label: 'Label created' },
  { status: 'on_hold', label: 'On hold' },
] as const;

export default async function DashboardPage({ searchParams }: { searchParams: Promise<ViewParams & { rank?: string; pulse?: string }> }) {
  const user = await requireUser();
  const params = await searchParams;
  const [view, counts, tasks, customerList, dates] = await Promise.all([analyticsView(params), statusCounts(), openTasks(user.id), allCustomers(), orderDatesByCustomer()]);
  const repeat = repeatStats(customerList, dates);
  const byCustomer = new Map(customerList.map((c) => [c.id, c]));
  const quietRegulars = overdueCustomers(dates).filter((o) => byCustomer.get(o.id));
  const { snapshot, period, data } = view;
  const brief = buildExecutiveBrief(snapshot, user.name.split(' ')[0]);
  const questions = buildExecutiveQuestions(snapshot);
  const rank = params.rank === 'profit' ? 'profit' : 'revenue';
  const pulse = params.pulse === 'orders' ? 'orders' : 'money';
  const current = { ...view.params, rank: params.rank, pulse: params.pulse };
  const link = (next: Record<string, string | undefined>) => hrefWith('/', current, next);
  const risks = snapshot.insights.filter((i) => i.kind === 'risk').slice(0, 3);
  const opportunities = snapshot.insights.filter((i) => i.kind === 'opportunity').slice(0, 3);
  const atStake = snapshot.insights.reduce((sum, i) => sum + (i.impactPLN ?? 0), 0);
  const top = [...snapshot.products].sort((a, b) => (rank === 'profit' ? b.marginPLN - a.marginPLN : b.revenuePLN - a.revenuePLN)).slice(0, 8);
  const productHref = (key: string) => `/analytics/products?open=${encodeURIComponent(key)}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description={`${period.key === 'all' ? 'Every order on record' : `${formatDate(period.from)} – ${formatDate(period.to)}`}, compared ${period.comparisonLabel}. Cancelled orders left out.`}
        actions={<Pills label="Period" options={PERIOD_OPTIONS} active={view.periodKey} href={(v) => link({ period: v })} />}
      />

      <section aria-label="Open orders" className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {OPEN.map((o) => (
          <Link key={o.status} href={`/orders?status=${o.status}`} className="rounded-2xl border border-black/5 bg-white px-4 py-3 hover:border-brand-500">
            <p className="text-xs font-medium text-slate-500">{o.label}</p>
            <p className="mt-0.5 text-xl font-semibold tabular-nums text-slate-900">{counts[o.status] ?? 0}</p>
          </Link>
        ))}
      </section>

      {(tasks.length > 0 || repeat.customers > 0) && (
        <section aria-label="Customers" className="grid grid-cols-1 gap-3 lg:grid-cols-[2fr_1fr_1fr]">
          <Card>
            <CardBody className="space-y-2">
              <p className="flex items-center justify-between text-sm font-semibold">
                My tasks
                <Link href="/customers/tasks" className="text-xs font-normal text-brand-700 hover:underline">
                  All tasks →
                </Link>
              </p>
              {tasks.length ? (
                <ul className="space-y-1 text-sm">
                  {tasks.slice(0, 5).map(({ task, customerName }) => (
                    <li key={task.id} className="flex justify-between gap-3">
                      <Link href={`/customers/${task.customerId}`} className="truncate hover:underline">
                        {task.title} <span className="text-slate-500">· {customerName}</span>
                      </Link>
                      <span className="shrink-0 text-xs text-slate-500">{task.dueAt ? formatDate(task.dueAt) : ''}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-slate-500">Nothing assigned to you.</p>
              )}
            </CardBody>
          </Card>
          <Link href="/customers/segments" className="rounded-2xl border border-black/5 bg-white px-4 py-3 hover:border-brand-500">
            <p className="text-xs font-medium text-slate-500">Customers who came back</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{Math.round(repeat.repeatRate * 100)}%</p>
            <p className="text-xs text-slate-500">
              {repeat.repeatCustomers} of {repeat.customers} customers ordered again
            </p>
          </Link>
          <Link href="/customers/segments" className="rounded-2xl border border-black/5 bg-white px-4 py-3 hover:border-brand-500">
            <p className="text-xs font-medium text-slate-500">Regulars gone quiet</p>
            <p className={cn('mt-1 text-xl font-semibold tabular-nums', quietRegulars.length > 0 && 'text-amber-700')}>{quietRegulars.length}</p>
            <p className="text-xs text-slate-500">over twice their usual gap since the last order</p>
          </Link>
        </section>
      )}

      {data.lineItems.length === 0 ? (
        <Card>
          <EmptyState title="No sales to analyse yet">
            Orders appear here once they sync. For your history, use “Import past orders” on each account in{' '}
            <Link href="/settings/integrations" className="underline">
              Settings → Integrations
            </Link>
            , and add product costs in{' '}
            <Link href="/settings/costs" className="underline">
              Costs & margins
            </Link>
            .
          </EmptyState>
        </Card>
      ) : snapshot.isEmpty ? (
        <Card>
          <EmptyState title="No orders in this period">
            <Link href={link({ period: 'all' })} className="underline">
              Show all time
            </Link>
          </EmptyState>
        </Card>
      ) : (
        <>
          <BriefCard brief={brief} atStake={atStake} />

          <section>
            <SectionTitle
              title="Summary"
              description={`${snapshot.totals.orders} orders from ${snapshot.totals.customers} customers. Profit is after VAT, fees, product cost, shipping and refunds.`}
            />
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
              {snapshot.kpis.map((kpi) => (
                <KpiCard key={kpi.key} kpi={kpi} comparisonLabel={period.comparisonLabel} granularity={period.granularity} />
              ))}
            </div>
          </section>

          <section>
            <SectionTitle
              title="Top products"
              actions={
                <div className="flex items-center gap-2">
                  <Pills
                    label="Rank products by"
                    options={[
                      { value: 'revenue', label: 'Revenue' },
                      { value: 'profit', label: 'Profit' },
                    ]}
                    active={rank}
                    href={(v) => link({ rank: v })}
                  />
                  <Link href={hrefWith('/analytics/products', view.params, {})} className={buttonClass('secondary', 'sm')}>
                    All products
                  </Link>
                </div>
              }
            />
            <Card className="overflow-x-auto">
              <table className="w-full">
                <thead className="border-b border-slate-100 bg-slate-50/60">
                  <tr>
                    <th className={th}>Product</th>
                    <th className={cn(th, 'text-right')}>Units</th>
                    <th className={cn(th, 'text-right')}>Revenue</th>
                    <th className={cn(th, 'text-right')}>Profit</th>
                    <th className={cn(th, 'text-right')}>Margin</th>
                    <th className={cn(th, 'text-right')}>Share of profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {top.map((p) => (
                    <tr key={p.productKey}>
                      <td className={td}>
                        <Link href={productHref(p.productKey)} className="font-medium text-slate-900 hover:underline">
                          {p.label}
                        </Link>
                        <span className="block text-xs text-slate-500">
                          {p.brand}
                          {p.costUnknown && ' · cost missing'}
                        </span>
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{p.units}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{formatValue(p.revenuePLN, 'pln')}</td>
                      <td className={cn(td, 'text-right tabular-nums', p.marginPLN < 0 && 'text-red-700')}>{formatValue(p.marginPLN, 'pln')}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{formatValue(p.marginPct, 'percent')}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{Math.round(p.marginShare * 100)}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          {questions.length > 0 && (
            <section>
              <SectionTitle title="Questions worth asking" description="Answered from your own numbers; a card only appears when the data supports an answer." />
              <div className="grid grid-cols-1 items-start gap-3 lg:grid-cols-2 xl:grid-cols-3">
                {questions.map((q) => (
                  <QuestionCard key={q.id} answer={q} />
                ))}
              </div>
            </section>
          )}

          <HealthCard health={snapshot.health} />

          <section>
            <SectionTitle
              title="What needs a decision"
              actions={
                <Link href={hrefWith('/analytics/actions', view.params, {})} className={buttonClass('secondary', 'sm')}>
                  All {snapshot.insights.length} findings
                </Link>
              }
            />
            <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <ShieldAlert className="size-4 text-red-600" aria-hidden /> Risks to your profit
                </h3>
                {risks.length ? (
                  risks.map((i) => <InsightCard key={i.id} insight={i} productHref={productHref} />)
                ) : (
                  <Card>
                    <EmptyState title="No profit risks detected">
                      <CheckCircle2 className="mx-auto size-5 text-emerald-600" aria-hidden />
                    </EmptyState>
                  </Card>
                )}
              </div>
              <div className="space-y-3">
                <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <TrendingUp className="size-4 text-emerald-600" aria-hidden /> Opportunities
                </h3>
                {opportunities.length ? (
                  opportunities.map((i) => <InsightCard key={i.id} insight={i} productHref={productHref} />)
                ) : (
                  <Card>
                    <EmptyState title="No scaling opportunities yet" />
                  </Card>
                )}
              </div>
            </div>
          </section>

          <section>
            <SectionTitle
              title="Business pulse"
              description={`By ${period.granularity}; quiet ${period.granularity}s show as zero.`}
              actions={
                <Pills
                  label="Pulse metric"
                  options={[
                    { value: 'money', label: 'Revenue & profit' },
                    { value: 'orders', label: 'Orders' },
                  ]}
                  active={pulse}
                  href={(v) => link({ pulse: v })}
                />
              }
            />
            <Card>
              <CardBody>
                <PulseChart
                  metric={pulse}
                  granularity={period.granularity}
                  data={snapshot.series.map((p) => ({ date: p.date, revenue: Math.round(p.revenuePLN), profit: Math.round(p.marginPLN), orders: p.orders }))}
                />
              </CardBody>
            </Card>
          </section>

          <section>
            <SectionTitle title="Where you sell" />
            <Card>
              <CardBody>
                <ChannelBars channels={snapshot.channels} />
              </CardBody>
            </Card>
          </section>

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
