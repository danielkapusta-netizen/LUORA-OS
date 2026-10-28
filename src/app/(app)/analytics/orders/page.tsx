import { Minus, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { hrefWith, Pills } from '@/components/analytics/blocks';
import { formatValue, MARKETPLACE_COLORS } from '@/components/analytics/format';
import { ProfitBreakdown } from '@/components/analytics/profit-breakdown';
import { Badge, Card, EmptyState, Input, td, th } from '@/components/ui';
import { channelName } from '@/lib/analytics/insights';
import { cn } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { orderProfit } from '@/server/analytics/dataset';
import { analyticsView, type ViewParams } from '@/server/analytics/view';
import { ViewFilters } from '../filters';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';
import { intlTag } from '@/lib/i18n/locales';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Analytics · Orders P&L') };
}

const PAGE = 30;
type Params = ViewParams & { q?: string; margin?: string; page?: string; open?: string };

export default async function OrdersProfitPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await getT();
  await requireUser();
  const params = await searchParams;
  const view = await analyticsView(params);
  const margin = params.margin === 'healthy' || params.margin === 'thin' || params.margin === 'loss' ? params.margin : 'any';
  const q = params.q?.trim().toLowerCase();
  const current = { ...view.params, q: params.q, margin: params.margin };
  const link = (next: Record<string, string | undefined>) => hrefWith('/analytics/orders', { ...current, page: params.page, open: params.open }, next);

  const orders = view.snapshot.orders
    .filter((o) => !q || o.customerName.toLowerCase().includes(q) || o.items.some((i) => i.productLabel.toLowerCase().includes(q) || i.orderNumber?.toLowerCase().includes(q)))
    .filter((o) => {
      const m = o.marginPct ?? 0;
      return margin === 'any' || (margin === 'healthy' ? m >= 15 : margin === 'thin' ? m >= 0 && m < 15 : m < 0);
    });
  const page = Math.max(1, Number(params.page) || 1);
  const pages = Math.max(1, Math.ceil(orders.length / PAGE));
  const shown = orders.slice((page - 1) * PAGE, page * PAGE);
  const showProfit = view.showProfit;
  const openLines = params.open && showProfit ? await orderProfit(params.open) : [];
  const revenue = orders.reduce((s, o) => s + o.revenuePLN, 0);
  const profit = orders.reduce((s, o) => s + o.marginPLN, 0);

  return (
    <>
      <ViewFilters view={view} path="/analytics/orders" extra={current} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Pills
          label={t('Margin')}
          options={[
            { value: 'any', label: msg('Any margin') },
            { value: 'healthy', label: msg('15% or more') },
            { value: 'thin', label: msg('Under 15%') },
            { value: 'loss', label: 'Loss' },
          ]}
          active={margin}
          href={(v) => hrefWith('/analytics/orders', current, { margin: v === 'any' ? undefined : v })}
        />
        <form action="/analytics/orders">
          {Object.entries({ ...view.params, margin: params.margin }).map(([k, v]) => v && <input key={k} type="hidden" name={k} value={v} />)}
          <Input name="q" defaultValue={params.q ?? ''} placeholder={t('Order, customer or product')} className="h-8 w-64" aria-label={t('Search orders')} />
        </form>
        <span className="text-sm text-slate-600">
          {t.plural(orders.length, '{n} order', '{n} orders')} · {t('{amount} revenue', { amount: formatValue(revenue, 'pln', false, t.locale) })}
          {showProfit && <> · {t('{amount} profit', { amount: formatValue(profit, 'pln', false, t.locale) })}</>}
        </span>
      </div>
      <Card className="overflow-x-auto">
        {shown.length === 0 ? (
          <EmptyState title={t('No orders match')} />
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className="w-10" />
                <th className={th}>{t('Date')}</th>
                <th className={th}>{t('Order')}</th>
                <th className={th}>{t('Customer')}</th>
                <th className={cn(th, 'text-right')}>{t('Revenue')}</th>
                <th className={cn(th, 'text-right')}>{t('Fees')}</th>
                {showProfit && <th className={cn(th, 'text-right')}>{t('Profit')}</th>}
                <th className={cn(th, 'text-right')}>{t('Margin')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {shown.map((o) => {
                const open = params.open === o.id;
                const Icon = open ? Minus : Plus;
                const first = o.items[0];
                return [
                  <tr key={o.id} id={`o-${o.id}`} className={open ? 'bg-slate-50' : undefined}>
                    <td className="py-3 pr-0 pl-4 align-top">
                      <Link
                        href={`${link({ open: open ? undefined : o.id })}#o-${o.id}`}
                        aria-label={open ? t('Hide details') : t('Show details')}
                        className="flex size-6 items-center justify-center rounded-md border border-slate-200 bg-white text-slate-500 hover:text-slate-800"
                      >
                        <Icon className="size-3.5" />
                      </Link>
                    </td>
                    <td className={cn(td, 'whitespace-nowrap')}>{o.date?.toLocaleDateString(intlTag(t.locale), { day: 'numeric', month: 'short', year: '2-digit' })}</td>
                    <td className={td}>
                      <Link href={`/orders/${o.id}`} className="font-medium hover:underline">
                        {first.orderNumber}
                      </Link>
                      <span className="flex items-center gap-1.5 text-xs text-slate-500">
                        <span className="inline-block size-2 rounded-sm" style={{ background: MARKETPLACE_COLORS[o.source] }} aria-hidden />
                        {channelName(o.source)} · {t('{n} pcs', { n: o.units })}
                        {o.items.some((i) => i.feesEstimated) && <Badge tone="amber">{t('fee estimated')}</Badge>}
                      </span>
                    </td>
                    <td className={td}>{o.customerName}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(o.revenuePLN, 'pln', false, t.locale)}</td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(o.commissionPLN, 'pln', false, t.locale)}</td>
                    {showProfit && <td className={cn(td, 'text-right tabular-nums', o.marginPLN < 0 && 'text-red-700')}>{formatValue(o.marginPLN, 'pln', false, t.locale)}</td>}
                    <td className={cn(td, 'text-right tabular-nums')}>{formatValue(o.marginPct, 'percent', false, t.locale)}</td>
                  </tr>,
                  open && (
                    <tr key={`${o.id}-detail`} className="bg-slate-50">
                      <td colSpan={8} className="px-4 pb-4">
                        <div className="grid grid-cols-1 gap-6 pt-2 lg:grid-cols-2">
                          <table className="w-full text-sm">
                            <tbody className="divide-y divide-slate-200">
                              {o.items.map((i) => (
                                <tr key={i.id}>
                                  <td className="py-1.5 pr-3">
                                    {i.qty} × {i.productLabel}
                                    {!i.costKnown && <Badge tone="amber" className="ml-1.5">{t('no cost')}</Badge>}
                                  </td>
                                  <td className="py-1.5 text-right tabular-nums">{formatValue(i.revenuePLN, 'pln', false, t.locale)}</td>
                                  {showProfit ? <td className={cn('py-1.5 text-right tabular-nums', i.marginPLN < 0 && 'text-red-700')}>{formatValue(i.marginPLN, 'pln', false, t.locale)}</td> : <td className="py-1.5 text-right tabular-nums">{formatValue(i.marginPct, 'percent', false, t.locale)}</td>}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {showProfit && <ProfitBreakdown lines={openLines} />}
                        </div>
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="flex justify-end gap-3 border-t border-slate-100 px-4 py-2 text-sm">
            {page > 1 && <Link href={link({ page: String(page - 1), open: undefined })}>{t('← Newer')}</Link>}
            <span className="text-slate-500">
              {t('Page {page} of {pages}', { page, pages })}
            </span>
            {page < pages && <Link href={link({ page: String(page + 1), open: undefined })}>{t('Older →')}</Link>}
          </div>
        )}
      </Card>
    </>
  );
}
