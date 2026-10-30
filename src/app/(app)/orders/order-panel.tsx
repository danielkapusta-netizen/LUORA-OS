import { ExternalLink, FileText, MapPin, Printer, Store, Truck } from 'lucide-react';
import Link from 'next/link';
import { AutoRefresh } from '@/components/auto-refresh';
import { PrintLabelButton } from '@/components/print-label-button';
import { ShipmentBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { CustomerSummary, OrderItemsList } from '@/components/order-summary';
import { buttonClass, Card } from '@/components/ui';
import { CARRIER_LABELS, formatDate, ordinal, SERVICE_LABELS } from '@/lib/utils';
import { requireUser } from '@/server/auth';
import { invoicesForOrder } from '@/server/services/invoicing';
import { notesForOrders } from '@/server/services/order-notes';
import { listUsers } from '@/server/services/settings';
import { listProjects, tagCounts } from '@/server/services/tasks';
import { getOrderDetail, returningInfo } from '@/server/services/orders';
import { loadRoutingData, routeOrder } from '@/server/services/shipping';
import { PackedToggle } from '../shipments/packed-toggle';
import { createInvoiceAction } from '../accounting/actions';
import { pollShipmentAction, quickLabelAction, retryTrackingAction } from './actions';
import { ImportantNotes, OrderNotes } from './order-notes';
import { getT } from '@/lib/i18n/server';

function InfoRow({ icon: Icon, label, children }: { icon: typeof Store; label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3 py-2.5">
      <Icon className="mt-0.5 size-4 shrink-0 text-slate-400" />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-500">{label}</p>
        <div className="mt-0.5 text-sm text-ink">{children}</div>
      </div>
    </div>
  );
}

/** Right-hand details panel on the Orders page. */
export async function OrderPanel({ orderId }: { orderId: string }) {
  const t = await getT();
  const detail = await getOrderDetail(orderId);
  if (!detail) return null;
  const { order, account, items, shipments } = detail;
  const viewer = await requireUser();
  const notes = (await notesForOrders([order.id])).get(order.id) ?? [];
  // The task form is only needed when there is a note to turn into a task.
  const [people, projectCards, tagList] = notes.length ? await Promise.all([listUsers(), listProjects(), tagCounts({ limit: 20 })]) : [[], [], []];
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
  const [invoice] = await invoicesForOrder(order.id);
  const returning = (await returningInfo([{ id: order.id, customerId: order.customerId, placedAt: order.placedAt }])).get(order.id);

  return (
    <Card className="p-4 2xl:p-6 max-xl:border-0 max-xl:bg-transparent max-xl:p-0 max-xl:shadow-none">
      <AutoRefresh active={waiting} />
      <CustomerSummary compact buyerName={order.buyer.name} recipientName={a.name} href={order.customerId ? `/customers/${order.customerId}` : undefined} />
      {returning && order.customerId && (
        <Link
          href={`/customers/${order.customerId}`}
          className="mt-2 flex items-center justify-between gap-2 rounded-2xl border border-violet-200 bg-violet-50 px-3 py-1.5 text-sm text-violet-900 hover:border-violet-300"
        >
          <span className="font-semibold">{t('Returning customer · {ordinal} order', { ordinal: ordinal(returning.orderNumber, t.locale) })}</span>
          <span className="text-xs">{t('first ordered {date}', { date: formatDate(returning.firstOrderAt, false, t.locale) })} →</span>
        </Link>
      )}

      <ImportantNotes notes={notes.filter((n) => n.pinned)} className="mt-2" />


      {/* Card order: customer, what was bought, how it ships (with the label actions), then notes. */}
      <div className="mt-3 rounded-2xl border border-sky/55 bg-sky-tint p-4">
      <p className="text-xs font-medium text-sky-ink">{t('Order items')}</p>
      <OrderItemsList items={items.slice(0, 3)} className="mt-3" highlightQuantity photoFirst />
      {items.length > 3 && (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-center text-xs font-medium text-slate-600 hover:text-ink group-open:hidden">{t('Show all {n} items', { n: items.length })}</summary>
          <OrderItemsList items={items.slice(3)} className="mt-2.5" highlightQuantity photoFirst />
        </details>
      )}
      </div>

      <div className="mt-3 rounded-2xl border border-butter/60 bg-butter-tint p-4">
        <div className="flex gap-3">
          <Truck className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">{t('Delivery')}</p>
            <div className="mt-0.5 text-sm text-ink">
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
                <span className="text-slate-500">{t('Not chosen yet')}</span>
              )}
              {order.deliveryMethodName && <p className="mt-0.5 text-xs text-slate-500">{t('Buyer chose:')} {order.deliveryMethodName}</p>}
            </div>
          </div>
        </div>
        {/* Where it goes, right under how it goes, so both can be checked before the label is made. */}
        <div className="mt-3 flex gap-3 border-t border-black/[0.06] pt-3">
          <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-500">{order.pickupPointId ? t('Pickup point') : t('Ship to')}</p>
            <p className="mt-0.5 text-sm text-ink">
              {order.pickupPointId && <span className="font-medium">{order.pickupPointId} · </span>}
              {a.street}, {a.postalCode} {a.city}
            </p>
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {canShip && (
            <ActionForm action={quickLabelAction.bind(null, order.id)}>
              {/* Empik's green, so the main action on the card stands out. */}
              <SubmitButton className="w-full bg-gradient-to-br from-[#0f7a50] to-[#0b5e3e] hover:from-[#0b5e3e] hover:to-[#0b5e3e]" pendingText={t('Requesting label…')}>
                <Truck className="size-4" /> {t('Generate shipping label')}
              </SubmitButton>
            </ActionForm>
          )}
          {!order.readyToShip && order.status !== 'cancelled' && (
            <p className="text-center text-xs text-amber-700">{t('Waiting for the marketplace ({status}) before shipping.', { status: order.marketplaceStatus })}</p>
          )}
          {live?.state === 'pending' && (
            <div className="flex items-center justify-between gap-2">
              <ShipmentBadge state="pending" />
              <ActionForm action={pollShipmentAction.bind(null, order.id, live.id)} showOk={false}>
                <SubmitButton size="sm" variant="secondary">
                  {t('Check now')}
                </SubmitButton>
              </ActionForm>
            </div>
          )}
          {live?.state === 'created' && (
            <div className="grid grid-cols-2 items-center gap-2">
              <PrintLabelButton className={buttonClass('primary')} href={`/api/labels/${live.id}`}>
                <Printer className="size-4" /> {t('Print label')}
              </PrintLabelButton>
              <div className="flex justify-end">
                <PackedToggle shipmentId={live.id} packed={Boolean(live.packedAt)} />
              </div>
            </div>
          )}
          {live?.state === 'created' && (
            <p className="flex items-center justify-between gap-2 text-xs text-slate-500">
              <span>{live.packedAt ? t('Packed – moves to Shipped') : t('Tick when packed; the order stays where it is until then')}</span>
              {live.trackingUrl && (
                <a className="inline-flex shrink-0 items-center gap-1 font-medium text-ink underline-offset-4 hover:underline" href={live.trackingUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="size-3.5" /> {t('Track')}
                </a>
              )}
            </p>
          )}
          {live?.error && <p className="text-xs text-red-700">{live.error}</p>}
          {live?.state === 'created' &&
            (live.trackingPushedAt ? (
              <p className="text-center text-xs text-emerald-700">{t('Tracking sent to {account}', { account: account.name })}</p>
            ) : live.trackingPushError ? (
              <div className="space-y-1.5">
                <p className="text-xs text-red-700">{t('Tracking not sent:')} {live.trackingPushError}</p>
                <ActionForm action={retryTrackingAction.bind(null, order.id, live.id)} showOk={false}>
                  <SubmitButton size="sm" variant="secondary" className="w-full bg-white">
                    {t('Retry sending tracking')}
                  </SubmitButton>
                </ActionForm>
              </div>
            ) : (
              <p className="text-center text-xs text-slate-500">{t('Sending tracking to {account}…', { account: account.name })}</p>
            ))}
          {failed && <p className="text-xs text-red-700">{t('Last label failed:')} {failed.error}</p>}
          {canShip && !route && <p className="text-center text-xs text-slate-500">{t('No shipping rule matches; choose a carrier in the full order view.')}</p>}
        </div>

      </div>

      {/* Each part of the card has its own pastel, as on the Dashboard: delivery butter, notes peach, items sky. */}
      <div className="mt-3 rounded-2xl border border-peach/45 bg-peach-tint p-4">
        <OrderNotes
          orderId={order.id}
          orderNumber={order.externalNumber}
          notes={notes}
          viewer={viewer}
          taskDialog={{ people: people.map((u) => ({ id: u.id, name: u.name })), projects: projectCards.map((p) => ({ id: p.project.id, name: p.project.name })), tags: tagList.map((item) => item.tag) }}
        />
      </div>

      <div className="mt-4 divide-y divide-black/[0.05]">
        {!order.invoiceRequest && invoice && (invoice.state === 'issued' || invoice.state === 'pending') && (
          <InfoRow icon={FileText} label={t('Invoice')}>
            {invoice.state === 'pending' ? (
              <p className="text-xs text-slate-500">{t('Being issued…')}</p>
            ) : (
              <p className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-700">
                  {t('Invoice {number}', { number: invoice.number ?? invoice.externalId ?? '' })}
                  {invoice.uploadedAt ? ` ${t('sent to {account}', { account: account.name })}` : ''}
                </span>
                {invoice.r2Key && (
                  <a href={`/api/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline underline-offset-2">
                    PDF
                  </a>
                )}
              </p>
            )}
          </InfoRow>
        )}
        {order.invoiceRequest && (
          <InfoRow icon={FileText} label={t('Invoice requested')}>
            <p>
              <span className="font-medium">{order.invoiceRequest.name}</span>
              {order.invoiceRequest.taxId && <span className="text-slate-500"> · NIP {order.invoiceRequest.taxId}</span>}
            </p>
            {invoice?.state === 'issued' ? (
              <p className="mt-1 flex flex-wrap items-center gap-2 text-xs">
                <span className="text-emerald-700">{t('Invoice {number}', { number: invoice.number ?? invoice.externalId ?? '' })}{invoice.uploadedAt ? ` ${t('sent to {account}', { account: account.name })}` : ''}</span>
                {invoice.r2Key && (
                  <a href={`/api/invoices/${invoice.id}`} target="_blank" rel="noreferrer" className="font-medium text-brand-700 underline underline-offset-2">
                    PDF
                  </a>
                )}
              </p>
            ) : invoice?.state === 'external' ? (
              <p className="mt-1 text-xs text-slate-500">{t('Invoiced outside Luora')}</p>
            ) : invoice?.state === 'pending' ? (
              <p className="mt-1 text-xs text-slate-500">{t('Invoice being issued…')}</p>
            ) : invoice ? (
              <p className="mt-1 text-xs text-red-700">
                {invoice.state === 'manual' ? t('Issue by hand:') : t('Not issued:')}{' '}
                {invoice.error}{' '}
                <Link href="/accounting?tab=attention" className="underline">
                  {t('Accounting')}
                </Link>
              </p>
            ) : order.status !== 'cancelled' && (order.marketplace === 'allegro' || order.marketplace === 'empik' || order.marketplace === 'hebe') ? (
              <ActionForm action={createInvoiceAction.bind(null, order.id)} showOk={false}>
                <SubmitButton size="sm" variant="secondary" className="mt-1.5 bg-white" pendingText={t('Requesting…')}>
                  <FileText className="size-3.5" /> {t('Create invoice')}
                </SubmitButton>
              </ActionForm>
            ) : null}
          </InfoRow>
        )}
      </div>


      <Link href={`/orders/${order.id}`} className="mt-2 block text-center text-sm font-medium text-brand-700 underline underline-offset-4">
        {t('Open full order')}
      </Link>
      <p className="mt-3 text-center text-[11px] text-slate-500">{t('Updated {date}', { date: formatDate(order.updatedAt, true, t.locale) })}</p>
    </Card>
  );
}
