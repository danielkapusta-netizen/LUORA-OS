import { BadgeCheck, ExternalLink, FileText, Hash, MapPin, Printer, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { PrintLabelButton } from '@/components/print-label-button';
import { MarketplaceBadge, ShipmentBadge, StatusBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { CustomerSummary, OrderItemsList } from '@/components/order-summary';
import { buttonClass, Card } from '@/components/ui';
import { CARRIER_LABELS, cn, formatDate, formatMoney, SERVICE_LABELS } from '@/lib/utils';
import { invoicesForOrder } from '@/server/services/invoicing';
import { getOrderDetail } from '@/server/services/orders';
import { loadRoutingData, routeOrder } from '@/server/services/shipping';
import { PackedToggle } from '../shipments/packed-toggle';
import { createInvoiceAction } from '../accounting/actions';
import { pollShipmentAction, quickLabelAction, retryTrackingAction } from './actions';

function InfoRow({ icon: Icon, label, children }: { icon: typeof Store; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-400">{label}</p>
        <div className="mt-0.5 text-sm text-slate-800">{children}</div>
      </div>
    </div>
  );
}

/** Right-hand details panel on the Orders page. */
export async function OrderPanel({ orderId }: { orderId: string }) {
  const detail = await getOrderDetail(orderId);
  if (!detail) return null;
  const { order, account, items, shipments } = detail;
  const live = shipments.find((s) => s.state === 'pending' || s.state === 'created');
  const failed = !live ? shipments.find((s) => s.state === 'failed') : undefined;
  const canShip = !live && order.readyToShip && !['cancelled', 'shipped', 'delivered'].includes(order.status);

  // Which courier the shipping rules would use (no carrier API calls here).
  const routing = canShip ? await loadRoutingData() : null;
  const route = routing ? routeOrder(order, routing) : null;
  const routeCarrier = route ? routing!.carriers.find((c) => c.id === route.carrierAccountId) : null;
  const liveCarrier = live ? (await loadRoutingData()).carriers.find((c) => c.id === live.carrierAccountId) : null;
  const waiting = shipments.some((s) => s.state === 'pending') || Boolean(live && live.state === 'created' && !live.trackingPushedAt && !live.trackingPushError);
  const a = order.shippingAddress;
  const [invoice] = order.invoiceRequest ? await invoicesForOrder(order.id) : [];

  return (
    <Card className="p-5">
      <AutoRefresh active={waiting} />
      <CustomerSummary buyerName={order.buyer.name} recipientName={a.name} />

      {/* Items */}
      <div className="mt-4 flex items-center gap-3">
        <span className="h-px flex-1 bg-slate-200" />
        <span className="text-xs font-medium text-slate-500">Order items</span>
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <OrderItemsList items={items} currency={order.currency} className="mt-3" />
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-3">
        <span className="text-sm text-slate-500">Total{order.codAmount ? ' (cash on delivery)' : ''}</span>
        <span className="text-base font-semibold tabular-nums">{formatMoney(order.totalAmount, order.currency)}</span>
      </div>

      {/* Delivery method and actions */}
      <div className="mt-4 rounded-2xl bg-canvas p-4">
        <div className="flex gap-3">
          <Truck className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-400">Delivery</p>
            <div className="mt-0.5 text-sm text-slate-800">
              {live ? (
                <>
                  <span className="font-medium">{liveCarrier?.name ?? CARRIER_LABELS[live.carrier]}</span>
                  {live.service !== 'buyer_choice' && <span className="text-slate-500"> · {SERVICE_LABELS[live.service] ?? live.service}</span>}
                  {live.trackingNumber && <p className="mt-0.5 font-mono text-xs text-slate-500">{live.trackingNumber}</p>}
                </>
              ) : route && routeCarrier ? (
                <>
                  <span className="font-medium">{routeCarrier.name}</span>
                  {route.service !== 'buyer_choice' && <span className="text-slate-500"> · {SERVICE_LABELS[route.service] ?? route.service}</span>}
                </>
              ) : (
                <span className="text-slate-500">Not chosen yet</span>
              )}
              {order.deliveryMethodName && <p className="mt-0.5 text-xs text-slate-400">Buyer chose: {order.deliveryMethodName}</p>}
            </div>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {canShip && (
            <ActionForm action={quickLabelAction.bind(null, order.id)}>
              <SubmitButton className="w-full" pendingText="Requesting label…">
                <Truck className="size-4" /> Generate shipping label
              </SubmitButton>
            </ActionForm>
          )}
          {!order.readyToShip && order.status !== 'cancelled' && (
            <p className="text-center text-xs text-amber-700">Waiting for the marketplace ({order.marketplaceStatus}) before shipping.</p>
          )}
          {live?.state === 'pending' && (
            <div className="flex items-center justify-between gap-2">
              <ShipmentBadge state="pending" />
              <ActionForm action={pollShipmentAction.bind(null, order.id, live.id)} showOk={false}>
                <SubmitButton size="sm" variant="secondary">
                  Check now
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {live?.state === 'created' && (
            <div className="grid grid-cols-2 gap-2">
              <PrintLabelButton className={buttonClass('primary')} href={`/api/labels/${live.id}`}>
                <Printer className="size-4" /> Print label
              </PrintLabelButton>
              {live.trackingUrl ? (
                <a className={cn(buttonClass('secondary'), 'bg-white')} href={live.trackingUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-4" /> Track
                </a>
              ) : (
                <span />
              )}
            </div>
          )}
          {live?.state === 'created' && (
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs text-slate-500">{live.packedAt ? 'Packed – moves to Shipped' : 'Tick when packed; stays in To do until then'}</span>
              <PackedToggle shipmentId={live.id} packed={Boolean(live.packedAt)} />
            </div>
          )}
          {live?.error && <p className="text-xs text-red-700">{live.error}</p>}
          {live?.state === 'created' &&
            (live.trackingPushedAt ? (
              <p className="text-center text-xs text-emerald-700">Tracking sent to {account.name}</p>
            ) : live.trackingPushError ? (
              <div className="space-y-1.5">
                <p className="text-xs text-red-700">Tracking not sent: {live.trackingPushError}</p>
                <ActionForm action={retryTrackingAction.bind(null, order.id, live.id)} showOk={false}>
                  <SubmitButton size="sm" variant="secondary" className="w-full bg-white">
                    Retry sending tracking
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">Sending tracking to {account.name}…</p>
            ))}
          {failed && <p className="text-xs text-red-700">Last label failed: {failed.error}</p>}
          {canShip && !route && <p className="text-center text-xs text-slate-500">No shipping rule matches; choose a carrier in the full order view.</p>}
        </div>

      </div>
      <div className="mt-3 divide-y divide-slate-100">
        <InfoRow icon={Store} label="Source">
          <span className="flex items-center gap-2">
            <MarketplaceBadge marketplace={order.marketplace} />
            <span className="truncate text-slate-600">{account.name}</span>
          </span>
        </InfoRow>
        <InfoRow icon={Hash} label="Order #">
          <span className="font-medium">{order.externalNumber}</span>
          <span className="text-slate-500"> · {formatDate(order.placedAt, false)}</span>
        </InfoRow>
        <InfoRow icon={MapPin} label={order.pickupPointId ? 'Pickup point' : 'Ship to'}>
          {order.pickupPointId && <span className="font-medium">{order.pickupPointId} · </span>}
          {a.street}, {a.postalCode} {a.city}
        </InfoRow>
        <InfoRow icon={BadgeCheck} label="Status">
          <span className="flex flex-wrap items-center gap-2">
            <StatusBadge status={order.status} />
            <span className="text-xs text-slate-400">{account.name}: {order.marketplaceStatus}</span>
          </span>
        </InfoRow>
        {order.invoiceRequest && (
          <InfoRow icon={FileText} label="Invoice requested">
            <p>
              <span className="font-medium">{order.invoiceRequest.name}</span>
              {order.invoiceRequest.taxId && <span className="text-slate-500"> · NIP {order.invoiceRequest.taxId}</span>}
            </p>
            {invoice?.state === 'issued' ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-700">Invoice {invoice.number ?? invoice.externalId}{invoice.uploadedAt ? ` sent to ${account.name}` : ''}</span>
                {invoice.r2Key && (
                  <a href={`/api/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline underline-offset-2">
                    PDF
                  </a>
                )}
              </p>
            ) : invoice?.state === 'external' ? (
              <p className="mt-1 text-xs text-slate-500">Invoiced outside Luora</p>
            ) : invoice?.state === 'pending' ? (
              <p className="mt-1 text-xs text-slate-500">Invoice being issued…</p>
            ) : invoice ? (
              <p className="mt-1 text-xs text-red-700">
                {invoice.state === 'manual' ? 'Issue by hand: ' : 'Not issued: '}
                {invoice.error}{' '}
                <Link href="/accounting?tab=attention" className="underline">
                  Accounting
                </Link>
              </p>
            ) : order.status !== 'cancelled' && (order.marketplace === 'allegro' || order.marketplace === 'empik') ? (
              <ActionForm action={createInvoiceAction.bind(null, order.id)} showOk={false}>
                <SubmitButton size="sm" variant="secondary" className="mt-1.5 bg-white" pendingText="Requesting…">
                  <FileText className="size-3.5" /> Create invoice
                </SubmitButton>
              </ActionForm>
            ) : null}
          </InfoRow>
        )}
      </div>


      <Link href={`/orders/${order.id}`} className="mt-2 block text-center text-sm font-medium text-brand-700 underline underline-offset-4">
        Open full order
      </Link>
      <p className="mt-3 text-center text-[11px] text-slate-400">Updated {formatDate(order.updatedAt)}</p>
    </Card>
  );
}
