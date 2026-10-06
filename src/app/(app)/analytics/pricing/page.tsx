import { Minus, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hrefWith, Pills, SectionTitle } from '@/components/analytics/blocks';
import { PriceCharts, Waterfall } from '@/components/analytics/charts';
import { formatValue } from '@/components/analytics/format';
import { PriceSimulator } from '@/components/analytics/price-simulator';
import { Badge, Card, CardBody, EmptyState, Input, td, th } from '@/components/ui';
import { brandOf } from '@/lib/analytics/orders';
import { buildMarginHistory, buildPriceHistory, buildPricingWorkspace, buildWaterfall, PRICING_PERIODS, type PricingPeriodKey, type PricingRow } from '@/lib/analytics/pricing';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analyticsView, type ViewParams } from '@/server/analytics/view';

export const metadata: Metadata = { title: 'Analytics · Pricing' };

const STATUS = { green: 'bg-emerald-500', yellow: 'bg-amber-400', red: 'bg-red-500' } as const;
const STATUS_LABEL = { green: 'healthy', yellow: 'thin', red: 'unhealthy' } as const;

type Params = ViewParams & { window?: string; dimension?: string; q?: string; open?: string };

export default async function PricingPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireUser();
  const params = await searchParams;
  const view = await analyticsView({ marketplace: params.marketplace }, 'all');
  const window = (PRICING_PERIODS.some((p) => p.value === params.window) ? params.window : 'month') as PricingPeriodKey;
  const dimension = params.dimension === 'brand' ? 'brand' : 'product';
  const current = { marketplace: view.marketplace, window: params.window, dimension: params.dimension, q: params.q };
  const link = (next: Record<string, string | undefined>) => hrefWith('/analytics/pricing', { ...current, open: params.open }, next);
  const workspace = buildPricingWorkspace({ orders: view.data.orders, costs: view.data.costs, dimension, period: window, anchor: new Date(), brandOf });
  const rows = workspace.rows.filter((r) => !params.q || r.label.toLowerCase().includes(params.q.toLowerCase()));
  const risky = workspace.rows.filter((r) => r.risk);
  const s = workspace.summary;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Pills label="Window" options={PRICING_PERIODS} active={window} href={(v) => link({ window: v })} />
        <Pills
          label="Group by"
          options={[
            { value: 'product', label: 'Products' },
            { value: 'brand', label: 'Brands' },
          ]}
          active={dimension}
          href={(v) => link({ dimension: v, open: undefined })}
        />
        <form action="/analytics/pricing" className="flex items-center gap-2">
          {Object.entries({ marketplace: view.marketplace, window: params.window, dimension: params.dimension }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <Input name="q" defaultValue={params.q ?? ''} placeholder="Search" className="h-8 w-56" aria-label="Search" />
        </form>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          ['Portfolio margin', formatValue(s.avgMarginPct, 'percent'), 'last 30 days'],
          ['Profit on the table', formatValue(s.onTheTablePLN, 'pln'), 'a month, from recommended prices'],
          ['Healthy', String(s.aboveFifteen), 'margin above 15%'],
          ['Thin', String(s.tenToFifteen), 'margin 10–15%'],
          ['Unhealthy', String(s.belowTenPct), 'margin below 10%'],
        ].map(([label, value, caption]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-slate-500">{caption}</p>
          </Card>
        ))}
      </div>

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title="No sales in this window" />
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="w-10" />
                <th className={th}>{dimension === 'brand' ? 'Brand' : 'Product'}</th>
                <th className={cn(th, 'text-right')}>Current price</th>
                <th className={cn(th, 'text-right')}>Average price</th>
                <th className={cn(th, 'text-right')}>Profit / order</th>
                <th className={cn(th, 'text-right')}>Margin</th>
                <th className={cn(th, 'text-right')}>Monthly profit</th>
                <th className={cn(th, 'text-right')}>Monthly revenue</th>
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
                      <span className="flex items-center gap-2 font-medium text-slate-900">
                        <span className={cn('inline-block size-2 shrink-0 rounded-full', STATUS[r.status])} aria-hidden />
                        {r.label}
                      </span>
                      <span className="block text-xs text-slate-500">
                        {STATUS_LABEL[r.status]} · {r.ordersInWindow} sale(s){r.costUnknown && ' · cost missing'}
                        {r.risk && ' · margin falling'}
                      </span>
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.currentPricePLN, 'pln')}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.averagePricePLN, 'pln')}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.averageProfitPLN, 'pln')}</td>
                    <td className={cn(td, 'text-right tabular-nums', r.averageMarginPct < 0 && 'text-red-700')}>{formatValue(r.averageMarginPct, 'percent')}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.monthlyProfitPLN, 'pln')}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.monthlyRevenuePLN, 'pln')}</td>
                  </tr>,
                  open && (
                    <tr key={`${r.key}-detail`} className="bg-slate-50">
                      <td colSpan={8} className="px-4 pb-5">
                        <PricingDetail row={r} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
      </Card>

      {risky.length > 0 && (
        <section>
          <SectionTitle title="Margin at risk" description="Margin has fallen at least two months in a row." />
          <Card className="overflow-x-auto">
            <table className="w-full">
              <thead className="border-b border-slate-100 bg-slate-50/60">
                <tr>
                  <th className={th}>Product</th>
                  <th className={cn(th, 'text-right')}>Margin now</th>
                  <th className={cn(th, 'text-right')}>Before</th>
                  <th className={cn(th, 'text-right')}>Months falling</th>
                  <th className={cn(th, 'text-right')}>Cost a month</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {risky.map((r) => (
                  <tr key={r.key}>
                    <td className={td}>
                      <Link href={link({ open: r.key })} className="font-medium hover:underline">
                        {r.label}
                      </Link>
                      <span className="block text-xs text-slate-500">{r.risk!.note}</span>
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.risk!.currentMarginPct, 'percent')}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.risk!.previousMarginPct, 'percent')}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{r.risk!.streak}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(r.risk!.estMonthlyImpactPLN, 'pln')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </section>
      )}
    </div>
  );
}

function PricingDetail({ row }: { row: PricingRow }) {
  const waterfall = buildWaterfall(row);
  const rec = row.recommendation;
  const prices = buildPriceHistory(row.allLines).map((p) => ({ date: p.date.toISOString().slice(0, 10), price: Math.round(p.unitPricePLN * 100) / 100 }));
  const margins = buildMarginHistory(row.allLines, 'month').map((p) => ({ date: p.date, marginPct: Math.round(p.marginPct * 10) / 10 }));
  return (
    <div className="space-y-4 pt-2">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="font-semibold">Price</p>
            <dl className="grid grid-cols-2 gap-2">
              {[
                ['Current', row.currentPricePLN],
                ['Average', row.averagePricePLN],
                ['Lowest', row.stability.minPricePLN],
                ['Highest', row.stability.maxPricePLN],
              ].map(([k, v]) => (
                <div key={k as string}>
                  <dt className="text-xs text-slate-500">{k}</dt>
                  <dd className="tabular-nums">{formatValue(v as number, 'pln')}</dd>
                </div>
              ))}
            </dl>
            <p className="text-xs text-slate-500">
              {row.stability.distinctPrices} different price(s) · average discount {row.stability.avgDiscountPct.toFixed(1)}%
            </p>
            <p className="pt-2 font-semibold">Per order</p>
            <dl className="grid grid-cols-2 gap-2">
              <div>
                <dt className="text-xs text-slate-500">Fees</dt>
                <dd className="tabular-nums">{formatValue(row.avgCommissionPLN, 'pln')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Shipping, net</dt>
                <dd className="tabular-nums">{formatValue(row.avgShippingPLN, 'pln')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Unit cost</dt>
                <dd className="tabular-nums">{row.unitCostPLN === null ? 'missing' : formatValue(row.unitCostPLN, 'pln')}</dd>
              </div>
              <div>
                <dt className="text-xs text-slate-500">Fee rate</dt>
                <dd className="tabular-nums">{(row.commissionRate * 100).toFixed(1)}%</dd>
              </div>
            </dl>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="font-semibold">Price needed for a margin</p>
            <ul className="space-y-1">
              {row.targets.map((t) => (
                <li key={t.label} className="flex justify-between gap-3">
                  <span className={t.achieved ? 'text-emerald-700' : 'text-slate-600'}>{t.label}</span>
                  <span className="tabular-nums">{t.requiredPricePLN === null ? 'not reachable' : formatValue(t.requiredPricePLN, 'pln')}</span>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="space-y-2 text-sm">
            <p className="flex items-center gap-2 font-semibold">
              Recommendation <Badge tone={rec.kind === 'raise' ? 'amber' : rec.kind === 'fix-costs' ? 'red' : 'green'}>{rec.kind === 'raise' ? 'raise price' : rec.kind === 'fix-costs' ? 'fix costs' : 'hold'}</Badge>
            </p>
            {rec.recommendedPricePLN !== null && (
              <p>
                {formatValue(rec.recommendedPricePLN, 'pln')} → margin {formatValue(rec.expectedMarginPct, 'percent')}
                {rec.expectedMonthlyUpliftPLN !== null && <>, about +{formatValue(rec.expectedMonthlyUpliftPLN, 'pln')} a month</>}
              </p>
            )}
            <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-600">
              {rec.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
            <p className="text-xs text-slate-500">Confidence {rec.confidencePct}%</p>
          </CardBody>
        </Card>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {waterfall && (
          <Card>
            <CardBody>
              <p className="mb-2 text-sm font-semibold">Where one unit&apos;s price goes</p>
              <Waterfall
                steps={waterfall.map((w) => ({
                  label: w.label,
                  // Deductions are drawn downwards from the running total; the result keeps its sign.
                  value: w.kind === 'result' ? w.amountPLN : Math.abs(w.amountPLN),
                  kind: w.kind === 'start' ? 'start' : w.kind === 'result' ? 'total' : 'minus',
                }))}
              />
            </CardBody>
          </Card>
        )}
        {row.unitCostPLN !== null && (
          <Card>
            <CardBody>
              <p className="mb-2 text-sm font-semibold">Try another price</p>
              <PriceSimulator
                averagePrice={row.averagePricePLN}
                commissionRate={row.commissionRate}
                unitCost={row.unitCostPLN}
                monthlyUnits={row.monthlyUnits}
                averageMarginPct={row.averageMarginPct}
              />
            </CardBody>
          </Card>
        )}
      </div>
      {prices.length > 1 && <PriceCharts prices={prices} margins={margins} />}
    </div>
  );
}
