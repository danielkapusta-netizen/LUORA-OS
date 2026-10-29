import { RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SubmitButton } from '@/components/forms';
import { Alert, buttonClass, Card, Eyebrow, Input, Select } from '@/components/ui';
import { quickRanges } from '@/lib/analytics/window';
import { CARRIER_LABELS, cn, MARKETPLACE_LABELS, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { OrderStatus } from '@/server/db/schema';
import { labelReadyCount, listOrders, listTags, statusCounts, type OrderFilters } from '@/server/services/orders';
import { listMarketplaceAccounts, listUsers } from '@/server/services/settings';
import { STATUS_LABELS } from '@/server/services/workflow';
import { syncNowAction } from './actions';
import { OrderPanel } from './order-panel';
import { OrderSheet, OrderSheetProvider } from './order-sheet';
import { OrdersTable, type OrderRow } from './orders-table';
import { getT } from '@/lib/i18n/server';
import { msg } from '@/lib/i18n/msg';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t('Orders') };
}

const TABS: { value: OrderStatus | 'open' | 'all'; label: string; hint?: string }[] = [
  { value: 'open', label: msg('To do') },
  { value: 'new', label: msg('New') },
  { value: 'processing', label: msg('Processing') },
  { value: 'label_created', label: msg('Label created'), hint: msg('Labels made, parcel not packed yet. They also stay on their own tab until you press Packed.') },
  { value: 'on_hold', label: msg('On hold') },
  { value: 'shipped', label: msg('Shipped') },
  { value: 'delivered', label: msg('Delivered') },
  { value: 'cancelled', label: msg('Cancelled') },
  { value: 'all', label: msg('All') },
];

type Search = Record<string, string | undefined>;

function hrefWith(params: Search, patch: Search): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/orders?${qs}` : '/orders';
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
  const t = await getT();
  await requireUser();
  const params = await searchParams;
  const status = params.status ?? 'open';
  const filters: OrderFilters = {
    q: params.q,
    status: status === 'all' ? undefined : (status as OrderFilters['status']),
    marketplace: params.marketplace,
    accountId: params.account,
    assigneeId: params.assignee,
    tag: params.tag,
    carrier: params.carrier,
    invoiceRequested: params.invoice === 'requested',
    from: params.from,
    to: params.to,
    returning: params.returning === '1',
    notes: params.notes === 'important' ? 'important' : params.notes === '1' ? 'any' : undefined,
    page: Number(params.page ?? 1) || 1,
  };

  const [{ rows, total, page, pageSize }, counts, labelReady, accounts, users, tags] = await Promise.all([
    listOrders(filters),
    statusCounts(),
    labelReadyCount(),
    listMarketplaceAccounts(),
    listUsers(),
    listTags(),
  ]);
  const openCount = (counts.new ?? 0) + (counts.processing ?? 0) + (counts.label_created ?? 0) + (counts.on_hold ?? 0);
  const errors = accounts.filter((a) => a.enabled && a.lastError);
  const lastSync = accounts.map((a) => a.lastSyncedAt).filter(Boolean).sort().at(-1);
  const filtersActive = Boolean(params.marketplace || params.account || params.assignee || params.tag || params.invoice || params.from || params.to);
  // The details panel shows the chosen order, or the first one on the page.
  const selectedId = params.order ?? rows[0]?.order.id ?? null;

  const tableRows: OrderRow[] = rows.map(({ order, accountName, assigneeName, itemCount, products, shipment, returning, notes }) => ({
    id: order.id,
    number: order.externalNumber,
    marketplace: order.marketplace,
    accountName,
    placedAt: order.placedAt.toISOString(),
    buyer: order.buyer.name,
    customerId: order.customerId,
    products,
    city: order.shippingAddress.city,
    itemCount,
    total: order.totalAmount,
    currency: order.currency,
    cod: Boolean(order.codAmount && Number(order.codAmount) > 0),
    status: order.status,
    readyToShip: order.readyToShip,
    marketplaceStatus: order.marketplaceStatus,
    assignee: assigneeName,
    // What the buyer chose (e.g. "Allegro Paczkomaty InPost"); the label's carrier only when the marketplace gave no name.
    courier: order.deliveryMethodName ?? (shipment && shipment.state !== 'failed' ? (CARRIER_LABELS[shipment.carrier] ?? shipment.carrier) : null),
    returning: returning ? { orderNumber: returning.orderNumber, since: returning.firstOrderAt.toISOString() } : null,
    notes,
    shipment: shipment
      ? { id: shipment.id, state: shipment.state, trackingNumber: shipment.trackingNumber, carrier: shipment.carrier, hasLabel: shipment.state === 'created', packed: Boolean(shipment.packedAt) }
      : null,
  }));

  const filtersForm = (className: string) => (
    <form className={className} action="/orders">
      {params.status && <input type="hidden" name="status" value={params.status} />}
      {params.q && <input type="hidden" name="q" value={params.q} />}
      <Select name="marketplace" defaultValue={params.marketplace ?? ''}>
        <option value="">{t('All marketplaces')}</option>
        {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </Select>
      <Select name="account" defaultValue={params.account ?? ''}>
        <option value="">{t('All accounts')}</option>
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </Select>
      <Select name="assignee" defaultValue={params.assignee ?? ''}>
        <option value="">{t('Anyone')}</option>
        {users.map((u) => (
          <option key={u.id} value={u.id}>
            {u.name}
          </option>
        ))}
      </Select>
      <Select name="tag" defaultValue={params.tag ?? ''}>
        <option value="">{t('Any tag')}</option>
        {tags.map((item) => (
          <option key={item} value={item}>
            {item}
          </option>
        ))}
      </Select>
      <Select name="invoice" defaultValue={params.invoice ?? ''} className="col-span-2">
        <option value="">{t('Invoice requested or not')}</option>
        <option value="requested">{t('Invoice requested')}</option>
      </Select>
      <div className="col-span-2 flex flex-wrap gap-1.5" role="group" aria-label={t('Placed')}>
        {quickRanges().map((r) => {
          const on = params.from === r.from && params.to === r.to;
          return (
            <Link
              key={r.label}
              href={hrefWith(params, { from: r.from, to: r.to, page: undefined })}
              aria-current={on ? 'true' : undefined}
              className={cn('rounded-full px-3 py-1.5 text-xs font-medium whitespace-nowrap max-md:py-2 max-md:text-sm', on ? 'bg-ink text-white' : 'bg-black/[0.04] text-slate-700 hover:bg-black/[0.07]')}
            >
              {r.label}
            </Link>
          );
        })}
      </div>
      <Input type="date" name="from" defaultValue={params.from} aria-label={t('Placed from')} />
      <Input type="date" name="to" defaultValue={params.to} aria-label={t('Placed until')} />
      <div className="col-span-2 flex items-center justify-end gap-3">
        <Link href={hrefWith({ status: params.status }, {})} className="text-sm text-slate-500 hover:text-ink">
          {t('Clear')}
        </Link>
        <button className={buttonClass('primary', 'sm')}>{t('Apply')}</button>
      </div>
    </form>
  );
  const searchBox = (
    <>
      {params.status && <input type="hidden" name="status" value={params.status} />}
      <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
      <Input name="q" defaultValue={params.q} placeholder={t('Search number, buyer, SKU, tracking…')} aria-label={t('Search orders')} className="w-full rounded-full border-black/[0.08] bg-white pl-10 md:w-72" enterKeyHint="search" type="search" />
    </>
  );
  const tab = 'shrink-0 snap-start rounded-full px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors max-md:flex max-md:min-h-10 max-md:items-center';
  const chip = 'inline-flex shrink-0 snap-start items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm whitespace-nowrap transition-colors max-md:min-h-10';

  return (
    <OrderSheetProvider>
      <div className="mb-6 flex items-end justify-between gap-3 md:mb-8 md:flex-wrap">
        <div className="min-w-0">
          <Eyebrow className="mb-2">{t('All marketplaces in one list · last sync {when}', { when: timeAgo(lastSync, t) })}</Eyebrow>
          <h1 className="font-display text-4xl leading-tight font-semibold tracking-tight text-ink md:text-5xl">{t('Orders')}</h1>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <form action="/orders" className="relative hidden md:block">
            {searchBox}
          </form>
          <form action={syncNowAction}>
            <SubmitButton variant="secondary" pendingText={t('Syncing…')}>
              <RefreshCw className="size-4" /> {t('Sync now')}
            </SubmitButton>
          </form>
        </div>
      </div>

      {/* Phones: search and filters in one row, the filters opening full width underneath. */}
      <div className="relative mb-3 flex items-center gap-2 md:hidden">
        <form action="/orders" className="relative min-w-0 flex-1">
          {searchBox}
        </form>
        <details open={filtersActive}>
          <summary className={cn(buttonClass('secondary'), 'cursor-pointer list-none')}>
            <SlidersHorizontal className="size-4" /> {t('Filters')}{filtersActive ? ' •' : ''}
          </summary>
          {filtersForm('absolute inset-x-0 top-full z-20 mt-2 grid grid-cols-2 gap-2 rounded-3xl border border-black/[0.06] bg-white p-4 shadow-[0_16px_40px_-16px_rgba(28,27,25,0.25)]')}
        </details>
      </div>

      {errors.length > 0 && (
        <div className="mb-4 space-y-2">
          {errors.map((a) => (
            <Alert key={a.id} tone="red">
              <strong>{a.name}:</strong> {t('last sync failed –')} {a.lastError}{' '}
              <Link href="/settings/integrations" className="underline">
                {t('Check settings')}
              </Link>
            </Alert>
          ))}
        </div>
      )}

      {/* One scrolling row on a phone (it fades out at the edge to show there is more); wrapped on a desktop. */}
      <div className="fade-end -mx-4 mb-5 flex scroll-px-4 snap-x items-center gap-1 overflow-x-auto px-4 pb-1 max-md:scrollbar-none md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:pb-0 md:[mask-image:none]">
        <nav aria-label={t('Order status')} className="flex items-center gap-0.5 rounded-full bg-black/[0.04] p-1 max-md:shrink-0 md:flex-wrap md:rounded-3xl">
          {TABS.map((item) => {
            const count = item.value === 'open' ? openCount : item.value === 'label_created' ? labelReady : item.value !== 'all' ? counts[item.value] : undefined;
            const active = status === item.value;
            return (
              <Link
                key={item.label}
                href={hrefWith(params, { status: item.value === 'open' ? undefined : item.value, page: undefined, order: undefined })}
                aria-current={active ? 'true' : undefined}
                title={item.hint ? t(item.hint) : undefined}
                className={cn(tab, 'press', active ? 'bg-white font-medium text-ink shadow-[0_1px_2px_rgba(28,27,25,0.08)]' : 'text-slate-600 hover:text-ink')}
              >
                {t(item.label)}
                {count ? <span className={cn('ml-1.5 font-mono text-xs tabular-nums', active ? 'text-slate-500' : 'text-slate-400')}>{count}</span> : null}
              </Link>
            );
          })}
        </nav>
        <span className="mx-2 hidden h-6 w-px shrink-0 bg-black/[0.08] md:block" aria-hidden />
        {(
          [
            { key: 'returning', on: params.returning === '1', next: { returning: params.returning === '1' ? undefined : '1' }, label: msg('Returning customers'), dot: 'bg-violet-500' },
            { key: 'notes', on: params.notes === '1', next: { notes: params.notes === '1' ? undefined : '1' }, label: msg('With notes'), dot: 'bg-slate-500' },
            { key: 'important', on: params.notes === 'important', next: { notes: params.notes === 'important' ? undefined : 'important' }, label: msg('Important notes'), dot: 'bg-amber-500' },
          ] as const
        ).map((c) => (
          <Link
            key={c.key}
            href={hrefWith(params, { ...c.next, page: undefined, order: undefined })}
            className={cn(chip, 'press', c.on ? 'border-ink bg-ink text-white' : 'border-black/[0.08] bg-white text-slate-700 hover:border-black/20 hover:text-ink')}
            aria-pressed={c.on}
          >
            <span className={cn('size-1.5 rounded-full', c.on ? 'bg-white' : c.dot)} aria-hidden />
            {t(c.label)}
          </Link>
        ))}
        <details className="relative ml-auto hidden md:block" open={filtersActive}>
          <summary className={cn(buttonClass('secondary', 'sm'), 'cursor-pointer list-none')}>
            <SlidersHorizontal className="size-3.5" /> {t('Filters')}{filtersActive ? ' •' : ''}
          </summary>
          {filtersForm('absolute right-0 z-20 mt-2 grid w-[min(92vw,34rem)] grid-cols-2 gap-2 rounded-3xl border border-black/[0.06] bg-white p-4 shadow-[0_16px_40px_-16px_rgba(28,27,25,0.25)]')}
        </details>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="max-md:border-0 max-md:bg-transparent md:overflow-clip">
          <OrdersTable
            rows={tableRows}
            selectedId={selectedId}
            users={users.map((u) => ({ id: u.id, name: u.name }))}
            statuses={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <div className="flex items-center justify-between border-black/[0.04] py-3 text-sm text-slate-500 md:border-t md:px-5">
            <span>{total === 0 ? t('No orders') : t('{from}–{to} of {total}', { from: (page - 1) * pageSize + 1, to: Math.min(page * pageSize, total), total })}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link className={buttonClass('ghost', 'sm')} href={hrefWith(params, { page: String(page - 1), order: undefined })}>
                  {t('Previous')}
                </Link>
              )}
              {page * pageSize < total && (
                <Link className={buttonClass('ghost', 'sm')} href={hrefWith(params, { page: String(page + 1), order: undefined })}>
                  {t('Next')}
                </Link>
              )}
            </div>
          </div>
        </Card>
        <aside className="xl:sticky xl:top-6">{selectedId ? <OrderSheet><OrderPanel orderId={selectedId} /></OrderSheet> : null}</aside>
      </div>
    </OrderSheetProvider>
  );
}
