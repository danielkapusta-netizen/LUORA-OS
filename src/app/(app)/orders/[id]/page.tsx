import { ArrowLeft, ExternalLink, Printer } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AutoRefresh } from '@/components/auto-refresh';
import { PrintLabelButton } from '@/components/print-label-button';
import { MarketplaceBadge, ShipmentBadge, StatusBadge } from '@/components/badges';
import { ActionForm, SubmitButton } from '@/components/forms';
import { Alert, buttonClass, Card, CardBody, CardHeader, Field, Input, Select, td, Textarea, th } from '@/components/ui';
import { AvatarStack } from '@/components/tasks/avatars';
import { DueChip } from '@/components/tasks/chips';
import { DoneToggle } from '@/components/tasks/done-toggle';
import { NewTaskDialog } from '@/components/tasks/task-dialog';
import { today as warsawToday } from '@/lib/tasks/dates';
import { CARRIER_LABELS, cn, formatDate, formatMoney, SERVICE_LABELS } from '@/lib/utils';
import { can } from '@/lib/permissions';
import { requireUser } from '@/server/auth';
import { getOrderDetail } from '@/server/services/orders';
import { orderProfit } from '@/server/analytics/dataset';
import { ProfitBreakdown } from '@/components/analytics/profit-breakdown';
import { listUsers } from '@/server/services/settings';
import { listProjects, listTasks, tagCounts } from '@/server/services/tasks';
import { shippingFormData } from '@/server/services/shipping';
import { canTransition, MANUAL_TARGETS, STATUS_LABELS } from '@/server/services/workflow';
import {
  acceptOrderAction,
  addNoteAction,
  assignAction,
  cancelShipmentAction,
  changeStatusAction,
  createLabelAction,
  pollShipmentAction,
  refreshOrderAction,
  retryShipmentAction,
  retryTrackingAction,
  updateAddressAction,
} from '../actions';
import { LabelForm } from './label-form';

export const metadata: Metadata = { title: 'Order' };

const EVENT_DOT: Record<string, string> = {
  status: 'bg-violet-500',
  label: 'bg-amber-500',
  tracking: 'bg-emerald-500',
  error: 'bg-red-500',
  note: 'bg-blue-500',
  stock: 'bg-slate-400',
  sync: 'bg-slate-300',
  edit: 'bg-slate-400',
  invoice: 'bg-teal-500',
};

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const detail = await getOrderDetail(id);
  if (!detail) notFound();
  const { order, account, items, events, shipments } = detail;
  const [users, allProfitLines, orderTasks, projectCards, tagList] = await Promise.all([listUsers(), orderProfit(order.id), listTasks({ orderId: id }), listProjects(), tagCounts({ limit: 20 })]);
  const todayKey = warsawToday();
  const profitLines = can(user.role, 'profit') ? allProfitLines : [];
  const orderGross = allProfitLines.reduce((sum, l) => sum + Number(l.gross ?? 0), 0);
  const orderMargin = orderGross > 0 ? (allProfitLines.reduce((sum, l) => sum + Number(l.profit ?? 0), 0) / orderGross) * 100 : null;

  const active = shipments.find((s) => s.state === 'pending' || s.state === 'created');
  const canShip = !active && order.readyToShip && !['cancelled', 'shipped', 'delivered'].includes(order.status);
  const form = canShip ? await shippingFormData(order.id) : null;
  const pending = shipments.some((s) => s.state === 'pending') || shipments.some((s) => s.state === 'created' && !s.trackingPushedAt && !s.trackingPushError);
  const a = order.shippingAddress;
  const statusTargets = MANUAL_TARGETS.filter((s) => s !== order.status && canTransition(order.status, s));

  return (
    <>
      <AutoRefresh active={pending} />
      <Link href="/orders" className="mb-3 inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-800">
        <ArrowLeft className="size-4" /> Orders
      </Link>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold tracking-tight">Order {order.externalNumber}</h1>
            <StatusBadge status={order.status} />
            <MarketplaceBadge marketplace={order.marketplace} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {account.name} · placed {formatDate(order.placedAt)} · marketplace status <span className="font-medium">{order.marketplaceStatus}</span>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {order.marketplace === 'empik' && order.marketplaceStatus === 'WAITING_ACCEPTANCE' && (
            <ActionForm action={acceptOrderAction.bind(null, order.id)}>
              <SubmitButton pendingText="Accepting…">Accept order</SubmitButton>
            </ActionForm>
          )}
          <ActionForm action={refreshOrderAction.bind(null, order.id)}>
            <SubmitButton variant="secondary" pendingText="Refreshing…">
              Refresh from {account.name}
            </SubmitButton>
          </ActionForm>
        </div>
      </div>

      {!order.readyToShip && order.status !== 'cancelled' && (
        <div className="mb-4">
          <Alert>
            This order can&apos;t be shipped yet: the marketplace reports <strong>{order.marketplaceStatus}</strong>.
            {order.marketplace === 'empik' && ' Accept it first, then wait until Empik confirms the payment.'}
          </Alert>
        </div>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        <div className="space-y-5 xl:col-span-2">
          <Card>
            <CardHeader title="Shipping label" description={order.deliveryMethodName ? `Buyer chose: ${order.deliveryMethodName}` : undefined} />
            <CardBody className="space-y-4">
              {shipments.map((s) => (
                <div key={s.id} className={cn('rounded-md border px-3 py-2.5', s.state === 'cancelled' ? 'border-slate-100 opacity-60' : 'border-slate-200')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <ShipmentBadge state={s.state} />
                      <span className="font-medium">{CARRIER_LABELS[s.carrier]}</span>
                      <span className="text-slate-500">{SERVICE_LABELS[s.service] ?? s.service}</span>
                      {s.trackingNumber && <span className="font-mono text-xs">{s.trackingNumber}</span>}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {s.state === 'created' && (
                        <PrintLabelButton className={buttonClass('primary', 'sm')} href={`/api/labels/${s.id}`}>
                          <Printer className="size-3.5" /> Print label
                        </PrintLabelButton>
                      )}
                      {s.trackingUrl && (
                        <a className={buttonClass('secondary', 'sm')} href={s.trackingUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="size-3.5" /> Track
                        </a>
                      )}
                      {(s.state === 'pending' || (s.state === 'created' && s.error)) && (
                        <ActionForm action={pollShipmentAction.bind(null, order.id, s.id)} showOk={false}>
                          <SubmitButton size="sm" variant="secondary">
                            Check now
                          </SubmitButton>
                        </ActionForm>
                      )}
                      {s.state === 'failed' && !active && (
                        <ActionForm action={retryShipmentAction.bind(null, order.id, s.id)}>
                          <SubmitButton size="sm" variant="secondary">
                            Try again
                          </SubmitButton>
                        </ActionForm>
                      )}
                      {(s.state === 'created' || s.state === 'failed') && !s.trackingPushedAt && (
                        <ActionForm action={cancelShipmentAction.bind(null, order.id, s.id)}>
                          <SubmitButton size="sm" variant="danger" confirm="Cancel this label?">
                            Cancel label
                          </SubmitButton>
                        </ActionForm>
                      )}
                    </div>
                  </div>
                  <div className="mt-1.5 space-y-0.5 text-xs text-slate-500">
                    <p>
                      Parcel {s.parcel.lengthCm}×{s.parcel.widthCm}×{s.parcel.heightCm} cm, {s.parcel.weightKg} kg
                      {s.options.pickupPointId ? ` · point ${s.options.pickupPointId}` : ''}
                      {s.options.codAmount ? ` · COD ${formatMoney(s.options.codAmount, order.currency)}` : ''} · {s.labelFormat.toUpperCase()} {s.labelSize} · requested {formatDate(s.createdAt)}
                    </p>
                    {s.error && <p className="text-red-700">{s.error}</p>}
                    {s.state === 'created' &&
                      (s.trackingPushedAt ? (
                        <p className="text-emerald-700">Tracking sent to {account.name} {formatDate(s.trackingPushedAt)}</p>
                      ) : s.trackingPushError ? (
                        <div className="flex items-center gap-2 text-red-700">
                          <span>Tracking not sent: {s.trackingPushError}</span>
                          <ActionForm action={retryTrackingAction.bind(null, order.id, s.id)} showOk={false}>
                            <SubmitButton size="sm" variant="secondary">
                              Retry
                            </SubmitButton>
                          </ActionForm>
                        </div>
                      ) : (
                        <p>Sending tracking to {account.name}…</p>
                      ))}
                    {s.deliveryStatus && <p>Carrier status: {s.deliveryStatus.replace(/_/g, ' ')}</p>}
                  </div>
                </div>
              ))}
              {form && (
                <LabelForm
                  action={createLabelAction.bind(null, order.id)}
                  carriers={form.carriers.map((c) => ({
                    id: c.id,
                    name: c.name,
                    type: c.type,
                    labelFormat: c.settings.labelFormat ?? 'pdf',
                    labelSize: c.settings.labelSize ?? 'A6',
                  }))}
                  services={form.services}
                  presets={form.presets.map(({ id, name, lengthCm, widthCm, heightCm, weightKg, inpostTemplate }) => ({ id, name, lengthCm, widthCm, heightCm, weightKg, inpostTemplate }))}
                  defaults={{
                    carrierAccountId: form.route?.carrierAccountId ?? null,
                    service: form.route?.service ?? null,
                    presetId: form.defaultPreset?.id ?? null,
                    ruleName: form.route?.ruleName ?? null,
                  }}
                  order={{ codAmount: order.codAmount, pickupPointId: order.pickupPointId, currency: order.currency, totalAmount: order.totalAmount }}
                />
              )}
              {!form && shipments.length === 0 && <p className="text-sm text-slate-500">No label for this order.</p>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Items" />
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-slate-100">
                <thead className="bg-slate-50">
                  <tr>
                    <th className={th}>Product</th>
                    <th className={th}>SKU</th>
                    <th className={cn(th, 'text-right')}>Qty</th>
                    <th className={cn(th, 'text-right')}>Price</th>
                    <th className={cn(th, 'text-right')}>Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((i) => (
                    <tr key={i.id}>
                      <td className={td}>{i.name}</td>
                      <td className={cn(td, 'font-mono text-xs')}>
                        {i.sku ?? '—'}
                        {i.sku && !i.productId && <span className="ml-1 text-amber-700">(not in inventory)</span>}
                      </td>
                      <td className={cn(td, 'text-right tabular-nums')}>{i.quantity}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{formatMoney(i.unitPrice, order.currency)}</td>
                      <td className={cn(td, 'text-right tabular-nums')}>{formatMoney(Number(i.unitPrice) * i.quantity, order.currency)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="text-sm">
                  <tr>
                    <td colSpan={4} className={cn(td, 'text-right text-slate-500')}>
                      Shipping
                    </td>
                    <td className={cn(td, 'text-right tabular-nums')}>{formatMoney(order.shippingAmount, order.currency)}</td>
                  </tr>
                  <tr>
                    <td colSpan={4} className={cn(td, 'text-right font-medium')}>
                      Total {order.codAmount ? '(cash on delivery)' : ''}
                    </td>
                    <td className={cn(td, 'text-right font-semibold tabular-nums')}>{formatMoney(order.totalAmount, order.currency)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </Card>

          <Card>
            <CardHeader title="Buyer and shipping address" description="Edits here are used for new labels; the marketplace is not changed." />
            <CardBody>
              <p className="mb-3 text-sm text-slate-600">
                {order.customerId ? (
                  <Link href={`/customers/${order.customerId}`} className="font-medium text-brand-700 hover:underline">
                    {order.buyer.name}
                  </Link>
                ) : (
                  order.buyer.name
                )}
                {order.buyer.login ? ` (${order.buyer.login})` : ''} · {order.buyer.email ?? 'no email'} · {order.buyer.phone ?? 'no phone'}
              </p>
              <ActionForm action={updateAddressAction.bind(null, order.id)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Recipient">
                  <Input name="name" defaultValue={a.name} required />
                </Field>
                <Field label="Company">
                  <Input name="company" defaultValue={a.company ?? ''} />
                </Field>
                <Field label="Street and number" className="sm:col-span-2">
                  <Input name="street" defaultValue={a.street} required />
                </Field>
                <Field label="Postal code">
                  <Input name="postalCode" defaultValue={a.postalCode} required />
                </Field>
                <Field label="City">
                  <Input name="city" defaultValue={a.city} required />
                </Field>
                <Field label="Country">
                  <Input name="countryCode" defaultValue={a.countryCode} maxLength={2} />
                </Field>
                <Field label="Phone">
                  <Input name="phone" defaultValue={a.phone ?? ''} />
                </Field>
                <Field label="Email">
                  <Input name="email" type="email" defaultValue={a.email ?? ''} />
                </Field>
                <Field label="Pickup point (Paczkomat)">
                  <Input name="pickupPointId" defaultValue={order.pickupPointId ?? ''} placeholder="e.g. KRA010" />
                </Field>
                <div className="sm:col-span-2">
                  <SubmitButton variant="secondary">Save address</SubmitButton>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>

        <div className="space-y-5">
          {can(user.role, 'profit') ? (
            <Card>
              <CardHeader title="Profit" description="After VAT, fees, product cost, shipping and refunds, in PLN." />
              <CardBody>
                <ProfitBreakdown lines={profitLines} />
              </CardBody>
            </Card>
          ) : (
            can(user.role, 'margin') &&
            orderMargin !== null && (
              <Card>
                <CardHeader title="Margin" description="After VAT, fees, product cost, shipping and refunds." />
                <CardBody>
                  <p className={cn('text-2xl font-semibold tabular-nums', orderMargin < 0 ? 'text-red-700' : 'text-slate-900')}>{orderMargin.toFixed(1)}%</p>
                </CardBody>
              </Card>
            )
          )}
          <Card>
            <CardHeader title="Workflow" />
            <CardBody className="space-y-4">
              {statusTargets.length > 0 && (
                <ActionForm action={changeStatusAction.bind(null, order.id)} className="flex items-end gap-2">
                  <Field label="Move to" className="flex-1">
                    <Select name="status" defaultValue={statusTargets[0]}>
                      {statusTargets.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABELS[s]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <SubmitButton variant="secondary">Change</SubmitButton>
                </ActionForm>
              )}
              <ActionForm action={assignAction.bind(null, order.id)} className="space-y-3">
                <Field label="Assigned to">
                  <Select name="assigneeId" defaultValue={order.assigneeId ?? ''}>
                    <option value="">Nobody</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Tags" hint="Comma separated, e.g. gift, priority">
                  <Input name="tags" defaultValue={order.tags.join(', ')} />
                </Field>
                <SubmitButton variant="secondary">Save</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Tasks"
              description="Things to do about this order."
              actions={
                <NewTaskDialog
                  people={users.map((u) => ({ id: u.id, name: u.name }))}
                  projects={projectCards.map((p) => ({ id: p.project.id, name: p.project.name }))}
                  tags={tagList.map((t) => t.tag)}
                  meId={user.id}
                  label="Add"
                  variant="secondary"
                  size="sm"
                  defaults={{ orderId: order.id, title: `Order ${order.externalNumber}: ` }}
                />
              }
            />
            <CardBody>
              {orderTasks.length === 0 ? (
                <p className="text-sm text-slate-500">No tasks for this order.</p>
              ) : (
                <ul className="space-y-3">
                  {orderTasks.map((t) => (
                    <li key={t.id} className="flex items-start gap-2.5">
                      <DoneToggle id={t.id} done={t.status === 'done'} title={t.title} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/tasks/${t.id}`} className={cn('text-sm font-medium hover:underline', t.status === 'done' && 'text-slate-400 line-through')}>
                          {t.title}
                        </Link>
                        <div className="mt-1">
                          <DueChip task={t} today={todayKey} />
                        </div>
                      </div>
                      <AvatarStack people={t.assignees} size="sm" />
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Activity" />
            <CardBody className="space-y-4">
              <ActionForm action={addNoteAction.bind(null, order.id)} resetOnSuccess showOk={false} className="space-y-2">
                <Textarea name="note" rows={2} placeholder="Add an internal note…" required />
                <SubmitButton size="sm" variant="secondary">
                  Add note
                </SubmitButton>
              </ActionForm>
              <ol className="space-y-3">
                {events.map(({ event, userName }) => (
                  <li key={event.id} className="flex gap-2.5">
                    <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', EVENT_DOT[event.type] ?? 'bg-slate-300')} />
                    <div className="min-w-0">
                      <p className={cn('text-sm', event.type === 'note' ? 'whitespace-pre-wrap text-slate-900' : 'text-slate-700', event.type === 'error' && 'text-red-700')}>
                        {event.message}
                      </p>
                      <p className="text-xs text-slate-400">
                        {formatDate(event.createdAt)}
                        {userName ? ` · ${userName}` : ''}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
