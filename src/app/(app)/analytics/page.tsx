import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader, EmptyState, td, th } from '@/components/ui';
import { cn, formatDate, formatMoney, MARKETPLACE_LABELS, SERVICE_LABELS, CARRIER_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { analytics } from '@/server/services/analytics';
import { STATUS_LABELS } from '@/server/services/workflow';
import { MARKETPLACE_COLORS } from '@/components/analytics/format';
import { RangeControl } from '@/components/analytics/period-control';
import { resolveDayWindow } from '@/lib/analytics/window';
import { HorizontalBars, RevenueByDay } from './charts';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Analytics · Operations') };
}

const DAY_OPTIONS = [7, 30, 90, 365] as const;
const RANGES = [
  { value: '7', label: msg('7 days') },
  { value: '30', label: msg('30 days') },
  { value: '90', label: msg('90 days') },
  { value: '365', label: msg('12 months') },
  { value: 'lastweek', label: msg('Last week') },
];

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="px-4 py-3">
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{value}</p>
      {note && <p className="mt-0.5 text-xs text-slate-500">{note}</p>}
    </Card>
  );
}

function hours(value: number | null): string {
  if (value === null) return '—';
  return value < 48 ? `${value.toFixed(1)} h` : `${(value / 24).toFixed(1)} days`;
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ days?: string; from?: string; to?: string; marketplace?: string }> }) {
  const t = await getT();
  await requireUser();
  const params = await searchParams;
  const win = resolveDayWindow(params, DAY_OPTIONS, 30);
  const marketplace = params.marketplace && MARKETPLACE_LABELS[params.marketplace] ? params.marketplace : undefined;
  const { from, to } = win;
  const data = await analytics({ from, to, marketplace });
  // Every amount is converted to PLN by the service.
  const currency = 'PLN';
  const mixedCurrency = data.kpis.currencies.some((c) => c !== 'PLN');

  // One row per day with a column per marketplace, including empty days.
  const marketplaces = [...new Set(data.daily.map((d) => d.marketplace))].sort();
  const byDay = new Map<string, Record<string, number | string>>();
  for (let item = from.getTime(); item <= to.getTime(); item += 86_400_000) {
    const day = new Date(item).toLocaleDateString('sv-SE', { timeZone: 'Europe/Warsaw' });
    byDay.set(day, { day, ...Object.fromEntries(marketplaces.map((m) => [m, 0])) });
  }
  for (const d of data.daily) {
    const row = byDay.get(d.day) ?? { day: d.day };
    row[d.marketplace] = Math.round(d.revenue);
    byDay.set(d.day, row);
  }
  const daily = [...byDay.values()].sort((a, b) => String(a.day).localeCompare(String(b.day)));

  // The range in force (a preset, or two dates) rides along when the marketplace changes.
  const range = win.custom ? { from: win.custom.from, to: win.custom.to } : { days: win.key };
  const link = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...range, marketplace, ...patch })) if (v) next.set(k, v);
    return `/analytics?${next}`;
  };

  return (
    <>
      <p className="mb-4 text-sm text-slate-500">
        {t('Operations:')} {formatDate(from, false, t.locale)} – {formatDate(to, false, t.locale)} · {t('orders by placement date, cancelled orders excluded')}
      </p>

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <RangeControl path="/analytics" current={{ marketplace }} presets={RANGES} active={win.key} param="days" custom={win.custom} label={t('Period')} />
        <span className="mx-2 h-5 w-px bg-slate-200" />
        {[undefined, ...Object.keys(MARKETPLACE_LABELS)].map((m) => (
          <Link
            key={m ?? 'all'}
            href={link({ marketplace: m })}
            className={cn('rounded-md border px-3 py-1.5 text-sm', marketplace === m ? 'border-brand-600 bg-brand-50 font-medium text-brand-700' : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50')}
          >
            {m ? MARKETPLACE_LABELS[m] : t('All marketplaces')}
          </Link>
        ))}
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label={t('Revenue')} value={formatMoney(data.kpis.revenue, currency)} note={mixedCurrency ? t('incl. shipping; {currencies} converted at the NBP rate', { currencies: data.kpis.currencies.filter((c) => c !== 'PLN').join(', ') }) : t('incl. shipping')} />
        <Stat label={t('Orders')} value={data.kpis.orders.toLocaleString('pl-PL')} note={t('{n} cancelled', { n: data.kpis.cancelled })} />
        <Stat label={t('Average order')} value={formatMoney(data.kpis.aov, currency)} />
        <Stat label={t('Shipped')} value={data.kpis.shipped.toLocaleString('pl-PL')} note={data.kpis.orders ? t('{pct}% of orders', { pct: Math.round((data.kpis.shipped / data.kpis.orders) * 100) }) : undefined} />
        <Stat label={t('Time to ship')} value={hours(data.kpis.avgHoursToShip)} note={t('placed → tracking sent')} />
      </div>

      {data.kpis.orders === 0 ? (
        <Card>
          <EmptyState title={t('No orders in this period')} />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
          <Card className="xl:col-span-2">
            <CardHeader title={t('Revenue per day ({currency})', { currency })} description={t('Stacked by marketplace')} />
            <CardBody>
              <RevenueByDay data={daily} marketplaces={marketplaces} currency={currency} />
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-xs text-slate-500">{t('Show as table')}</summary>
                <div className="mt-2 max-h-64 overflow-auto">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr>
                        <th className={th}>{t('Day')}</th>
                        {marketplaces.map((m) => (
                          <th key={m} className={cn(th, 'text-right')}>
                            {MARKETPLACE_LABELS[m]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {daily.map((row) => (
                        <tr key={String(row.day)}>
                          <td className="px-3 py-1">{row.day}</td>
                          {marketplaces.map((m) => (
                            <td key={m} className="px-3 py-1 text-right tabular-nums">
                              {Number(row[m] ?? 0).toLocaleString('pl-PL')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('By marketplace')} />
            <CardBody>
              <HorizontalBars byMarketplace unit={currency} data={data.byMarketplace.map((m) => ({ key: m.marketplace, label: MARKETPLACE_LABELS[m.marketplace] ?? m.marketplace, value: Math.round(m.revenue) }))} />
              <table className="mt-2 min-w-full text-sm">
                <thead>
                  <tr>
                    <th className={th}>{t('Marketplace')}</th>
                    <th className={cn(th, 'text-right')}>{t('Orders')}</th>
                    <th className={cn(th, 'text-right')}>{t('Avg order')}</th>
                  </tr>
                </thead>
                <tbody>
                  {data.byMarketplace.map((m) => (
                    <tr key={m.marketplace}>
                      <td className={td}>
                        <span className="mr-2 inline-block size-2.5 rounded-sm" style={{ background: MARKETPLACE_COLORS[m.marketplace] }} />
                        {MARKETPLACE_LABELS[m.marketplace]}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{m.orders}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{formatMoney(m.aov, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Top products')} description={t('By units sold')} />
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>{t('Product')}</th>
                    <th className={cn(th, 'text-right')}>{t('Units')}</th>
                    <th className={cn(th, 'text-right')}>{t('Revenue')}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.topSkus.map((s) => (
                    <tr key={s.sku ?? s.name}>
                      <td className={td}>
                        <div className="max-w-56 truncate">{s.name}</div>
                        <div className="font-mono text-xs text-slate-500">{s.sku ?? t('no SKU')}</div>
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{s.quantity}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{formatMoney(s.revenue, currency)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title={t('Labels by carrier')} />
            <CardBody>
              {data.carriers.length === 0 ? (
                <p className="text-sm text-slate-500">{t('No labels in this period.')}</p>
              ) : (
                <HorizontalBars
                  unit="labels"
                  data={data.carriers.map((c) => ({
                    key: `${c.carrier}-${c.service}`,
                    label: c.carrier === 'inpost' ? `InPost ${(SERVICE_LABELS[c.service] ?? c.service).toLowerCase()}` : (CARRIER_LABELS[c.carrier] ?? c.carrier),
                    value: c.shipments,
                  }))}
                />
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title={t('Time to ship')} description={t('Hours from order to tracking sent')} />
            <CardBody>
              {data.shipTime.length === 0 ? (
                <p className="text-sm text-slate-500">{t('Nothing shipped in this period.')}</p>
              ) : (
                <HorizontalBars
                  byMarketplace
                  unit="h"
                  decimals={1}
                  data={data.shipTime.map((s) => ({ key: s.marketplace, label: `${MARKETPLACE_LABELS[s.marketplace]} (${s.shipped})`, value: s.avgHours }))}
                />
              )}
              <h3 className="mt-4 mb-1 text-xs font-medium text-slate-500">{t('Open right now')}</h3>
              <ul className="space-y-1 text-sm">
                {data.backlog.map((b) => (
                  <li key={b.status} className="flex justify-between">
                    <Link href={`/orders?status=${b.status}`} className="text-brand-700 hover:underline">
                      {STATUS_LABELS[b.status as keyof typeof STATUS_LABELS] ?? b.status}
                    </Link>
                    <span className="tabular-nums">
                      {b.orders} <span className="text-xs text-slate-500">{t('oldest {date}', { date: formatDate(b.oldest, false, t.locale) })}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardBody>
          </Card>
        </div>
      )}
    </>
  );
}
