import { RefreshCw, Search, SlidersHorizontal } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SubmitButton } from '@/components/forms';
import { Alert, buttonClass, Card, Input, Select } from '@/components/ui';
import { CARRIER_LABELS, cn, MARKETPLACE_LABELS, timeAgo } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import type { OrderStatus } from '@/server/db/schema';
import { listOrders, listTags, statusCounts, type OrderFilters } from '@/server/services/orders';
import { listMarketplaceAccounts, listUsers } from '@/server/services/settings';
import { STATUS_LABELS } from '@/server/services/workflow';
import { syncNowAction } from './actions';
import { OrderPanel } from './order-panel';
import { OrdersTable, type OrderRow } from './orders-table';

export const metadata: Metadata = { title: 'Orders' };

const TABS: { value: OrderStatus | 'open' | 'all'; label: string }[] = [
  { value: 'open', label: 'To do' },
  { value: 'new', label: 'New' },
  { value: 'processing', label: 'Processing' },
  { value: 'label_created', label: 'Label created' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'shipped', label: 'Shipped' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

type Search = Record<string, string | undefined>;

function hrefWith(params: Search, patch: Search): string {
  const next = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...patch })) if (v) next.set(k, v);
  const qs = next.toString();
  return qs ? `/orders?${qs}` : '/orders';
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Search> }) {
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
    page: Number(params.page ?? 1) || 1,
  };

  const [{ rows, total, page, pageSize }, counts, accounts, users, tags] = await Promise.all([
    listOrders(filters),
    statusCounts(),
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

  const tableRows: OrderRow[] = rows.map(({ order, accountName, assigneeName, itemCount, shipment, returning }) => ({
    id: order.id,
    number: order.externalNumber,
    marketplace: order.marketplace,
    accountName,
    placedAt: order.placedAt.toISOString(),
    buyer: order.buyer.name,
    city: order.shippingAddress.city,
    itemCount,
    total: order.totalAmount,
    currency: order.currency,
    cod: Boolean(order.codAmount && Number(order.codAmount) > 0),
    status: order.status,
    readyToShip: order.readyToShip,
    marketplaceStatus: order.marketplaceStatus,
    assignee: assigneeName,
    courier: shipment && shipment.state !== 'failed' ? (CARRIER_LABELS[shipment.carrier] ?? shipment.carrier) : order.deliveryMethodName,
    returning: returning ? { orderNumber: returning.orderNumber, since: returning.firstOrderAt.toISOString() } : null,
    shipment: shipment
      ? { id: shipment.id, state: shipment.state, trackingNumber: shipment.trackingNumber, carrier: shipment.carrier, hasLabel: shipment.state === 'created' }
      : null,
  }));

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-slate-500">All marketplaces in one list · last sync {timeAgo(lastSync)}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <form action="/orders" className="relative">
            {params.status && <input type="hidden" name="status" value={params.status} />}
            <Search className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400" />
            <Input name="q" defaultValue={params.q} placeholder="Search number, buyer, SKU, tracking…" className="w-72 rounded-full bg-white pl-10" />
          </form>
          <form action={syncNowAction}>
            <SubmitButton variant="secondary" pendingText="Syncing…">
              <RefreshCw className="size-4" /> Sync now
            </SubmitButton>
          </form>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="mb-4 space-y-2">
          {errors.map((a) => (
            <Alert key={a.id} tone="red">
              <strong>{a.name}:</strong> last sync failed – {a.lastError}{' '}
              <Link href="/settings/integrations" className="underline">
                Check settings
              </Link>
            </Alert>
          ))}
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {TABS.map((tab) => {
          const count = tab.value === 'open' ? openCount : tab.value !== 'all' ? counts[tab.value] : undefined;
          const active = status === tab.value;
          return (
            <Link
              key={tab.label}
              href={hrefWith(params, { status: tab.value === 'open' ? undefined : tab.value, page: undefined, order: undefined })}
              className={cn(
                'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
                active ? 'border-brand-600 bg-brand-600 text-white' : 'border-black/10 bg-white text-slate-600 hover:border-black/20 hover:text-slate-900',
              )}
            >
              {tab.label}
              {count ? <span className={cn('ml-1.5 text-xs', active ? 'text-white/80' : 'text-slate-400')}>{count}</span> : null}
            </Link>
          );
        })}
        <Link
          href={hrefWith(params, { returning: params.returning === '1' ? undefined : '1', page: undefined, order: undefined })}
          className={cn(
            'rounded-full border px-4 py-1.5 text-sm font-medium transition-colors',
            params.returning === '1' ? 'border-violet-600 bg-violet-600 text-white' : 'border-violet-200 bg-violet-50 text-violet-800 hover:border-violet-300',
          )}
          aria-pressed={params.returning === '1'}
        >
          Returning customers
        </Link>
        <details className="relative ml-auto" open={filtersActive}>
          <summary className={cn(buttonClass('secondary', 'sm'), 'cursor-pointer list-none')}>
            <SlidersHorizontal className="size-3.5" /> Filters{filtersActive ? ' •' : ''}
          </summary>
          <form className="absolute right-0 z-20 mt-2 grid w-[min(92vw,34rem)] grid-cols-2 gap-2 rounded-2xl border border-black/5 bg-white p-4 shadow-lg" action="/orders">
            {params.status && <input type="hidden" name="status" value={params.status} />}
            {params.q && <input type="hidden" name="q" value={params.q} />}
            <Select name="marketplace" defaultValue={params.marketplace ?? ''}>
              <option value="">All marketplaces</option>
              {Object.entries(MARKETPLACE_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
            <Select name="account" defaultValue={params.account ?? ''}>
              <option value="">All accounts</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
            <Select name="assignee" defaultValue={params.assignee ?? ''}>
              <option value="">Anyone</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <Select name="tag" defaultValue={params.tag ?? ''}>
              <option value="">Any tag</option>
              {tags.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </Select>
            <Select name="invoice" defaultValue={params.invoice ?? ''} className="col-span-2">
              <option value="">Invoice requested or not</option>
              <option value="requested">Invoice requested</option>
            </Select>
            <Input type="date" name="from" defaultValue={params.from} aria-label="Placed from" />
            <Input type="date" name="to" defaultValue={params.to} aria-label="Placed until" />
            <div className="col-span-2 flex items-center justify-end gap-3">
              <Link href={hrefWith({ status: params.status }, {})} className="text-sm text-slate-500 hover:text-slate-800">
                Clear
              </Link>
              <button className={buttonClass('primary', 'sm')}>Apply</button>
            </div>
          </form>
        </details>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_400px]">
        <Card className="overflow-hidden">
          <OrdersTable
            rows={tableRows}
            selectedId={selectedId}
            users={users.map((u) => ({ id: u.id, name: u.name }))}
            statuses={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
          />
          <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3 text-sm text-slate-500">
            <span>{total === 0 ? 'No orders' : `${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total}`}</span>
            <div className="flex gap-2">
              {page > 1 && (
                <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page - 1), order: undefined })}>
                  Previous
                </Link>
              )}
              {page * pageSize < total && (
                <Link className={buttonClass('secondary', 'sm')} href={hrefWith(params, { page: String(page + 1), order: undefined })}>
                  Next
                </Link>
              )}
            </div>
          </div>
        </Card>
        <aside className="xl:sticky xl:top-6">{selectedId ? <OrderPanel orderId={selectedId} /> : null}</aside>
      </div>
    </>
  );
}
