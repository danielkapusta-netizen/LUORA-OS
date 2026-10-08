import { Minus, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hrefWith, InsightCard, Pills } from '@/components/analytics/blocks';
import { HistoryCharts } from '@/components/analytics/charts';
import { formatBucket, formatValue } from '@/components/analytics/format';
import { Badge, Card, CardBody, EmptyState, Input, td, th } from '@/components/ui';
import { buildCatalogue, buildCatalogueHistory, scoreCatalogueRow, type CatalogueDimension, type CatalogueRow } from '@/lib/analytics/catalogue';
import { formatDate } from '@/lib/analytics/format';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, type AnalyticsView, type ViewParams } from '@/server/analytics/view';
import { ViewFilters } from '../filters';

export const metadata: Metadata = { title: 'Analytics · Products' };

const DIMENSIONS = [
  { value: 'product', label: 'Products' },
  { value: 'brand', label: 'Brands' },
  { value: 'category', label: 'Categories' },
];
const SORTS = [
  { value: 'revenue', label: 'Revenue' },
  { value: 'profit', label: 'Profit' },
  { value: 'margin', label: 'Margin %' },
  { value: 'orders', label: 'Orders' },
];
const GRADE = { excellent: 'green', good: 'blue', watch: 'amber', poor: 'red' } as const;

type Params = ViewParams & { dimension?: string; sort?: string; q?: string; open?: string };

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const params = await searchParams;
  const view = await analyticsView(params);
  const dimension = (DIMENSIONS.some((d) => d.value === params.dimension) ? params.dimension : 'product') as CatalogueDimension;
  const sorts = view.showProfit ? SORTS : SORTS.filter((s) => s.value !== 'profit');
  const sort = sorts.some((s) => s.value === params.sort) ? params.sort! : 'revenue';
  const current = { ...view.params, dimension: params.dimension, sort: params.sort, q: params.q };
  const link = (next: Record<string, string | undefined>) => hrefWith('/analytics/products', { ...current, open: params.open }, next);

  const rows = buildCatalogue(view.fullSnapshot.orders, dimension, view.fullSnapshot.products)
    .filter((r) => !params.q || r.label.toLowerCase().includes(params.q.toLowerCase()))
    .sort((a, b) =>
      sort === 'profit' ? b.marginPLN - a.marginPLN : sort === 'margin' ? b.marginPct - a.marginPct : sort === 'orders' ? b.orders - a.orders : b.revenuePLN - a.revenuePLN,
    );

  return (
    <>
      <ViewFilters view={view} path="/analytics/products" extra={current} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Pills label="Group by" options={DIMENSIONS} active={dimension} href={(v) => link({ dimension: v, open: undefined })} />
        <Pills label="Sort by" options={sorts} active={sort} href={(v) => link({ sort: v })} />
        <form action="/analytics/products" className="flex items-center gap-2">
          {Object.entries({ ...view.params, dimension: params.dimension, sort: params.sort }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <Input name="q" defaultValue={params.q ?? ''} placeholder="Search" className="h-8 w-56" aria-label="Search products" />
        </form>
      </div>
      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="Nothing sold in this period" />
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="w-10" />
                <th className={th}>{DIMENSIONS.find((d) => d.value === dimension)?.label.replace(/s$/, '')}</th>
                <th className={cn(th, 'text-right')}>Orders</th>
                <th className={cn(th, 'text-right')}>Units</th>
                <th className={cn(th, 'text-right')}>Revenue</th>
                {view.showProfit && <th className={cn(th, 'text-right')}>Profit</th>}
                <th className={cn(th, 'text-right')}>Margin</th>
                {view.showProfit && <th className={cn(th, 'text-right')}>Share of profit</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => {
                const open = params.open === r.key;
                const Icon = open ? Minus : Plus;
                return [
                  <tr key={r.key} id={`row-${r.key}`} className={open ? 'bg-slate-50' : undefined}>
                    <td className="py-3 pr-0 pl-4 align-top">
                      <Link
                        href={`${link({ open: open ? undefined : r.key })}#row-${r.key}`}
                        aria-label={open ? 'Hide details' : 'Show details'}
                        className="flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
                      >
                        <Icon className="size-3.5" />
                      </Link>
                    </td>
                    <td className={td}>
                      <span className="font-medium text-slate-900">{r.label}</span>
                      <span className="block text-xs text-slate-500">
                        {r.memberCount > 1 && `${r.memberCount} products · `}last sold {formatDate(r.lastSold)}
                        {r.costUnknown && (
                          <Badge tone="amber" className="ml-1.5">
                            cost missing
                          </Badge>
                        )}
                      </span>
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{r.orders}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{r.units}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.revenuePLN, 'pln')}</td>
                    {view.showProfit && <td className={cn(td, 'text-right tabular-nums', r.marginPLN < 0 && 'text-red-700')}>{formatValue(r.marginPLN, 'pln')}</td>}
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.marginPct, 'percent')}</td>
                    {view.showProfit && <td className={cn(td, 'text-right tabular-nums')}>{Math.round(r.marginShare * 100)}%</td>}
                  </tr>,
                  open && (
                    <tr key={`${r.key}-detail`} className="bg-slate-50">
                      <td colSpan={8} className="px-4 pb-5">
                        <RowDetail row={r} view={view} dimension={dimension} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </Card>
    </>
  );
}

function RowDetail({ row, view, dimension }: { row: CatalogueRow; view: AnalyticsView; dimension: CatalogueDimension }) {
  const history = buildCatalogueHistory(view.data.orders, row.productKeys);
  const health = scoreCatalogueRow(row, view.snapshot.totals.marginPct, history);
  const insights = view.snapshot.insights.filter((i) => i.entity && row.productKeys.includes(i.entity.key));
  const members = dimension === 'product' ? [] : view.snapshot.products.filter((p) => row.productKeys.includes(p.productKey));
  const figures = [
    ['Average basket', formatValue(row.avgOrderValuePLN, 'pln')],
    ['Unit price', formatValue(row.avgUnitPricePLN, 'pln')],
    ...(view.showProfit ? [['Profit per order', formatValue(row.orders ? row.marginPLN / row.orders : 0, 'pln')]] : []),
    ['Share of revenue', `${Math.round(row.revenueShare * 100)}%`],
    ['First sale', formatDate(row.firstSold)],
    ['Last sale', formatDate(row.lastSold)],
  ];
  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_1fr]">
        <Card>
          <CardBody className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="text-3xl font-semibold tabular-nums">{health.score}</span>
              <Badge tone={GRADE[health.grade]}>{health.grade}</Badge>
            </div>
            <p className="text-sm text-slate-600">{health.summary}</p>
            <ul className="space-y-1 text-xs">
              {health.factors.map((f) => (
                <li key={f.label} className={f.positive ? 'text-emerald-800' : 'text-red-800'}>
                  <span className="font-medium">{f.label}:</span> {f.detail}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-sm lg:grid-cols-6">
              {figures.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="font-medium tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
            {history.length > 1 ? (
              <HistoryCharts data={history.map((h) => ({ month: h.date, marginPct: Math.round(h.marginPct * 10) / 10, units: h.units, orders: h.orders }))} />
            ) : (
              <p className="text-xs text-slate-500">History charts appear after a second month of sales.</p>
            )}
            {dimension === 'product' && !row.key.startsWith('item:') && (
              <p className="text-xs">
                <Link href={`/settings/costs?q=${encodeURIComponent(row.label.slice(0, 40))}`} className="text-brand-700 hover:underline">
                  Product cost →
                </Link>
              </p>
            )}
          </CardBody>
        </Card>
      </div>
      <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
        <table className="w-full">
          <thead>
            <tr>
              <th className={th}>Month</th>
              <th className={cn(th, 'text-right')}>Orders</th>
              <th className={cn(th, 'text-right')}>Units</th>
              <th className={cn(th, 'text-right')}>Unit price</th>
              <th className={cn(th, 'text-right')}>Revenue</th>
              {view.showProfit && <th className={cn(th, 'text-right')}>Profit</th>}
              <th className={cn(th, 'text-right')}>Margin</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {[...history].reverse().map((h) => (
              <tr key={h.date}>
                <td className={td}>{formatBucket(h.date, 'month')}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{h.orders}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{h.units}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{formatValue(h.avgUnitPricePLN, 'pln')}</td>
                <td className={cn(td, 'text-right tabular-nums')}>{formatValue(h.revenuePLN, 'pln')}</td>
                {view.showProfit && <td className={cn(td, 'text-right tabular-nums')}>{formatValue(h.marginPLN, 'pln')}</td>}
                <td className={cn(td, 'text-right tabular-nums')}>{formatValue(h.marginPct, 'percent')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {members.length > 0 && (
        <div className="text-sm">
          <p className="mb-1 font-medium">Products in this {dimension}</p>
          <ul className="grid grid-cols-1 gap-1 md:grid-cols-2">
            {members.map((p) => (
              <li key={p.productKey} className="flex justify-between gap-3 text-slate-600">
                <span className="truncate">{p.label}</span>
                <span className="tabular-nums">
                  {formatValue(p.revenuePLN, 'pln')} · {formatValue(p.marginPct, 'percent')}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {insights.length > 0 && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {insights.map((i) => (
            <InsightCard key={i.id} insight={i} />
          ))}
        </div>
      )}
    </div>
  );
}
