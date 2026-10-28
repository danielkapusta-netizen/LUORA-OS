import type { Metadata } from 'next';
import Link from 'next/link';
import { hrefWith, Pills } from '@/components/analytics/blocks';
import { formatValue, MARKETPLACE_COLORS } from '@/components/analytics/format';
import { Badge, buttonClass, Card, EmptyState, Input, Select, td, th } from '@/components/ui';
import { repeatStats, SEGMENT_ORDER, SEGMENTS } from '@/lib/crm/segments';
import { cn, MARKETPLACE_LABELS } from '@/lib/utils';
import { can } from '@/lib/permissions';
import { requireUser } from '@/server/auth';
import { CUSTOMER_SORTS, customerRows } from '@/server/services/customer-list';
import { orderDatesByCustomer } from '@/server/services/customers';
import { getT } from '@/lib/i18n/server';
import { intlTag } from '@/lib/i18n/locales';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Customers') };
}

const PAGE = 50;
type Params = { q?: string; segment?: string; marketplace?: string; tag?: string; sort?: string; page?: string };

export default async function CustomersPage({ searchParams }: { searchParams: Promise<Params> }) {
  const t = await getT();
  const user = await requireUser();
  const showProfit = can(user.role, 'profit');
  const asked = await searchParams;
  const params = showProfit || asked.sort !== 'profit' ? asked : { ...asked, sort: undefined };
  const [{ rows, all }, dates] = await Promise.all([customerRows(params), orderDatesByCustomer()]);
  const stats = repeatStats(all.map((r) => r.customer), dates);
  const counts = new Map<string, number>();
  for (const r of all) if (r.scored) counts.set(r.scored.segment, (counts.get(r.scored.segment) ?? 0) + 1);
  const tags = [...new Set(all.flatMap((r) => r.customer.tags))].sort();
  const page = Math.max(1, Number(params.page) || 1);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const current = { q: params.q, segment: params.segment, marketplace: params.marketplace, tag: params.tag, sort: params.sort };
  const link = (next: Record<string, string | undefined>) => hrefWith('/customers', current, { page: undefined, ...next });

  return (
    <>
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
        {[
          [t('Customers'), String(stats.customers), t('with at least one order')],
          [t('Came back'), `${Math.round(stats.repeatRate * 100)}%`, t('{n} ordered twice or more', { n: stats.repeatCustomers })],
          [t('Second order after'), stats.medianDaysToSecond === null ? '—' : t.plural(stats.medianDaysToSecond, '{n} day', '{n} days'), t('median, for those who came back')],
          [t('Revenue per customer'), formatValue(stats.averageRevenue, 'pln', false, t.locale), t('{n} orders on average', { n: stats.averageOrders.toFixed(1) })],
          [t('VIPs'), String(counts.get('vip') ?? 0), t('{n} more top spenders went quiet', { n: counts.get('cant_lose') ?? 0 })],
        ].map(([label, value, caption]) => (
          <Card key={label} className="px-4 py-3">
            <p className="text-xs font-medium text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-semibold tabular-nums">{value}</p>
            <p className="text-xs text-slate-500">{caption}</p>
          </Card>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Pills
          label={t('Segment')}
          options={[{ value: '', label: t('All') }, ...SEGMENT_ORDER.map((s) => ({ value: s, label: `${t(SEGMENTS[s].label)} (${counts.get(s) ?? 0})` }))]}
          active={params.segment ?? ''}
          href={(v) => link({ segment: v || undefined })}
        />
      </div>
      <form action="/customers" className="mb-4 flex flex-wrap items-center gap-2">
        {params.segment && <input type="hidden" name="segment" value={params.segment} />}
        <Input name="q" defaultValue={params.q ?? ''} placeholder={t('Name, e-mail, phone or city')} className="h-9 w-64" aria-label={t('Search customers')} />
        <Select name="marketplace" defaultValue={params.marketplace ?? ''} className="h-9 w-44" aria-label={t('Marketplace')}>
          <option value="">{t('All marketplaces')}</option>
          {Object.entries(MARKETPLACE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Select>
        {tags.length > 0 && (
          <Select name="tag" defaultValue={params.tag ?? ''} className="h-9 w-40" aria-label={t('Tag')}>
            <option value="">{t('Any tag')}</option>
            {tags.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </Select>
        )}
        <Select name="sort" defaultValue={params.sort ?? 'last'} className="h-9 w-44" aria-label={t('Sort by')}>
          {CUSTOMER_SORTS.filter((s) => showProfit || s.value !== 'profit').map((s) => (
            <option key={s.value} value={s.value}>
              {t(s.label)}
            </option>
          ))}
        </Select>
        <button className={buttonClass('secondary', 'sm')}>{t('Apply')}</button>
        <span className="text-sm text-slate-500">{t.plural(rows.length, '{n} customer', '{n} customers')}</span>
        {user.role === 'admin' && (
          <a href={hrefWith('/api/customers/export', current, {})} className={cn(buttonClass('ghost', 'sm'), 'ml-auto')}>
            {t('Export CSV')}
          </a>
        )}
      </form>

      <Card className="overflow-x-auto">
        {rows.length === 0 ? (
          <EmptyState title={t('No customers match')}>{t('Customers appear as orders sync; past orders are linked in the background.')}</EmptyState>
        ) : (
          <table className="w-full">
            <thead className="border-b border-slate-100 bg-slate-50/60">
              <tr>
                <th className={th}>{t('Customer')}</th>
                <th className={th}>{t('Segment')}</th>
                <th className={cn(th, 'text-right')}>{t('Orders')}</th>
                <th className={cn(th, 'text-right')}>{t('Revenue')}</th>
                {showProfit && <th className={cn(th, 'text-right')}>{t('Profit')}</th>}
                <th className={cn(th, 'text-right')}>{t('Basket')}</th>
                <th className={th}>{t('Last order')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.slice((page - 1) * PAGE, page * PAGE).map(({ customer: c, scored }) => (
                <tr key={c.id}>
                  <td className={td}>
                    <Link href={`/customers/${c.id}`} className="font-medium text-slate-900 hover:underline">
                      {c.displayName}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                      {c.marketplaces.map((m) => (
                        <span key={m} className="inline-flex items-center gap-1">
                          <span className="inline-block size-2 rounded-sm" style={{ background: MARKETPLACE_COLORS[m] }} aria-hidden />
                          {MARKETPLACE_LABELS[m] ?? m}
                        </span>
                      ))}
                      {c.city && <span>· {c.city}</span>}
                      {c.tags.map((item) => (
                        <Badge key={item} tone="gray">
                          {item}
                        </Badge>
                      ))}
                    </span>
                  </td>
                  <td className={td}>{scored && <Badge tone={SEGMENTS[scored.segment].tone}>{t(SEGMENTS[scored.segment].label)}</Badge>}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{c.ordersCount}</td>
                  <td className={cn(td, 'text-right tabular-nums')}>{formatValue(c.revenue, 'pln', false, t.locale)}</td>
                  {showProfit && <td className={cn(td, 'text-right tabular-nums', c.profit < 0 && 'text-red-700')}>{formatValue(c.profit, 'pln', false, t.locale)}</td>}
                  <td className={cn(td, 'text-right tabular-nums')}>{c.ordersCount ? formatValue(c.revenue / c.ordersCount, 'pln', false, t.locale) : '—'}</td>
                  <td className={cn(td, 'whitespace-nowrap')}>
                    {c.lastOrderAt?.toLocaleDateString(intlTag(t.locale), { day: 'numeric', month: 'short', year: 'numeric' }) ?? '—'}
                    {scored?.daysSince !== null && scored?.daysSince !== undefined && <span className="block text-xs text-slate-500">{t('{n} days ago', { n: scored.daysSince })}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {pages > 1 && (
          <div className="flex justify-end gap-3 border-t border-slate-100 px-4 py-2 text-sm">
            {page > 1 && <Link href={hrefWith('/customers', current, { page: String(page - 1) })}>{t('← Previous')}</Link>}
            <span className="text-slate-500">
              {t('Page {page} of {pages}', { page, pages })}
            </span>
            {page < pages && <Link href={hrefWith('/customers', current, { page: String(page + 1) })}>{t('Next →')}</Link>}
          </div>
        )}
      </Card>
    </>
  );
}
