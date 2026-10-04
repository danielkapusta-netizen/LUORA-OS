import { Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { PrintLabelButton } from '@/components/print-label-button';
import { ExpandableRow } from '@/components/expandable-row';
import { MarketplaceBadge, ShipmentBadge } from '@/components/badges';
import { buttonClass, Card, CardHeader, EmptyState, PageHeader, td, th } from '@/components/ui';
import { cn, formatDate, MARKETPLACE_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { invoicesByOrder, loadAccounting, uploadEnabled } from '@/server/services/invoicing';
import { itemsByOrder } from '@/server/services/orders';
import { recentBatches, recentShipments } from '@/server/services/shipping';
import { ShipmentOrderDetails } from './order-details';
import { InvoiceCell } from './invoice-cell';
import { PackedToggle } from './packed-toggle';
import { ActionForm, SubmitButton } from '@/components/forms';
import { retryFailedTrackingAction } from './actions';

export const metadata: Metadata = { title: 'Shipments' };

const STATES = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Being created' },
  { value: 'created', label: 'Label ready' },
  { value: 'failed', label: 'Failed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  await requireUser();
  const { state = '' } = await searchParams;
  const [rows, batches] = await Promise.all([recentShipments({ state: state || undefined }), recentBatches(10)]);
  const orderIds = rows.map((r) => r.order.id);
  const [items, invoices, accounting] = await Promise.all([itemsByOrder(orderIds), invoicesByOrder(orderIds), loadAccounting()]);
  const invoiceBusy = [...invoices.values()].some((i) => i.state === 'pending' || (i.state === 'issued' && !i.r2Key));

  return (
    <>
      <AutoRefresh active={rows.some((r) => r.shipment.state === 'pending') || invoiceBusy} />
      <PageHeader
        title="Shipments"
        description="Labels bought through InPost and Allegro Delivery, and an invoice for any order. To create labels in bulk, select orders on the Orders page."
        actions={
          rows.some((r) => r.shipment.trackingPushError && !r.shipment.trackingPushedAt) && (
            <ActionForm action={retryFailedTrackingAction}>
              <SubmitButton variant="secondary">Retry failed tracking</SubmitButton>
            </ActionForm>
          )
        }
      />
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-4">
        <Card className="xl:col-span-3">
          <CardHeader
            title="Recent labels"
            actions={STATES.map((s) => (
              <Link
                key={s.value}
                href={s.value ? `/shipments?state=${s.value}` : '/shipments'}
                className={cn('rounded-md px-2 py-1 text-xs font-medium', state === s.value ? 'bg-brand-50 text-brand-700' : 'text-slate-500 hover:bg-slate-100')}
              >
                {s.label}
              </Link>
            ))}
          />
          {rows.length === 0 ? (
            <EmptyState title="No labels yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="w-10" />
                    <th className={th}>Buyer</th>
                    <th className={th}>State</th>
                    <th className={th}>Invoice</th>
                    <th className={th}>Packed</th>
                    <th className={cn(th, 'text-right')}>Label</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {rows.map(({ shipment: s, order, carrierName }) => (
                    <ExpandableRow
                      key={s.id}
                      colSpan={6}
                      className="hover:bg-slate-50"
                      details={<ShipmentOrderDetails order={order} shipment={s} carrierName={carrierName} items={items.get(order.id) ?? []} />}
                    >
                      <td className={td}>
                        <p className="font-medium">{order.buyer.name}</p>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <MarketplaceBadge marketplace={order.marketplace} />
                          <Link href={`/orders/${order.id}`} className="text-brand-700 hover:underline">
                            {order.externalNumber}
                          </Link>
                          <span>· {formatDate(s.createdAt)}</span>
                        </div>
                      </td>
                      <td className={td}>
                        <ShipmentBadge state={s.state} />
                        {s.error && <div className="mt-1 max-w-80 text-xs text-red-700">{s.error}</div>}
                        <div className="mt-1 text-xs">
                          {s.trackingPushedAt ? (
                            <span className="text-emerald-700">Tracking sent to {MARKETPLACE_LABELS[order.marketplace]}</span>
                          ) : s.trackingPushError ? (
                            <span className="text-red-700">Tracking not sent: {s.trackingPushError}</span>
                          ) : s.state === 'created' ? (
                            <span className="text-slate-500">Sending tracking…</span>
                          ) : null}
                        </div>
                      </td>
                      <td className={td}>
                        {order.status !== 'cancelled' && (
                          <InvoiceCell
                            orderId={order.id}
                            marketplace={order.marketplace}
                            invoice={invoices.get(order.id)}
                            uploads={uploadEnabled(order.marketplace, accounting.settings)}
                          />
                        )}
                      </td>
                      <td className={td}>
                        {s.state === 'created' && <PackedToggle shipmentId={s.id} packed={Boolean(s.packedAt)} />}
                      </td>
                      <td className={cn(td, 'text-right')}>
                        {s.state === 'created' && (
                          <PrintLabelButton href={`/api/labels/${s.id}`} className={buttonClass('secondary', 'sm')}>
                            <Printer className="size-3.5" /> Print label
                          </PrintLabelButton>
                        )}
                      </td>
                    </ExpandableRow>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title="Bulk batches" />
          {batches.length === 0 ? (
            <EmptyState title="No batches yet">Select orders and press “Create labels”.</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100">
              {batches.map((b) => (
                <li key={b.id}>
                  <Link href={`/shipments/batches/${b.id}`} className="block px-4 py-2.5 hover:bg-slate-50">
                    <p className="text-sm font-medium text-brand-700">{b.total} order(s)</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(b.createdAt)}
                      {b.skipped.length ? ` · ${b.skipped.length} skipped` : ''}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
