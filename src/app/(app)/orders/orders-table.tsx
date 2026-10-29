'use client';

import { MessageSquareText, Printer, Truck } from 'lucide-react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { MarketplaceBadge, StatusBadge } from '@/components/badges';
import { PrintLabelButton } from '@/components/print-label-button';
import { ActionForm, SubmitButton } from '@/components/forms';
import { buttonClass, EmptyState, Select } from '@/components/ui';
import { cn, formatMoney, ordinal } from '@/lib/utils';
import type { OrderStatus } from '@/server/db/schema';
import { bulkAssignAction, bulkCreateLabelsAction, bulkStatusAction } from './actions';
import { useOrderSheet } from './order-sheet';
import { useT } from '@/lib/i18n/client';
import { intlTag, type Locale } from '@/lib/i18n/locales';
import type { T } from '@/lib/i18n/translate';

export interface OrderRow {
  id: string;
  number: string;
  marketplace: string;
  accountName: string;
  placedAt: string;
  buyer: string;
  /** The customer's account, for the link on their name. */
  customerId: string | null;
  /** What was bought, line by line. */
  products: { name: string; quantity: number }[];
  city: string;
  itemCount: number;
  total: string;
  currency: string;
  cod: boolean;
  status: OrderStatus;
  readyToShip: boolean;
  marketplaceStatus: string;
  assignee: string | null;
  courier: string | null;
  /** Set when the customer has ordered before: which order this is and when they first ordered. */
  returning: { orderNumber: number; since: string } | null;
  /** Internal notes on the order, and how many of them are marked important. */
  notes: { count: number; important: number } | null;
  shipment: { id: string; state: string; trackingNumber: string | null; carrier: string; hasLabel: boolean; packed: boolean } | null;
}

const th = 'px-3 py-3 text-left text-xs font-medium text-slate-500';
const td = 'px-3 py-4 text-sm';

function shortDate(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
}

function shortDay(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), { day: 'numeric', month: 'short', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
}

function shortTime(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
}

function sinceLabel(iso: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlTag(locale), { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
}

/** A label does not move an order, so the row says it has one: "Label ready" until the parcel is packed. */
function notesLabel(notes: { count: number; important: number }, t: T): string {
  const base = t.plural(notes.count, '{n} note', '{n} notes');
  return notes.important ? `${base}, ${t('{n} important', { n: notes.important })}` : base;
}

const SHOWN = 4;

/** What was bought, one product per line, in the same small type as the time under the date. */
function ProductList({ products }: { products: OrderRow['products'] }) {
  const t = useT();
  if (!products.length) return <span className="text-slate-400">—</span>;
  return (
    <ul className={cn('w-44 space-y-0.5 text-xs text-slate-500 2xl:w-52', products.length > 3 && 'leading-tight')} title={products.map((p) => `${p.quantity}× ${p.name}`).join('\n')}>
      {products.slice(0, SHOWN).map((p, i) => (
        <li key={i} className="flex gap-1">
          {p.quantity > 1 && <span className="shrink-0 font-medium tabular-nums text-slate-700">{p.quantity}×</span>}
          <span className={cn('min-w-0', products.length === 1 ? 'line-clamp-2' : 'truncate')}>{p.name}</span>
        </li>
      ))}
      {products.length > SHOWN && <li className="text-slate-500">{t('+{n} more', { n: products.length - SHOWN })}</li>}
    </ul>
  );
}

function LabelChip({ row }: { row: OrderRow }) {
  const t = useT();
  if (!row.shipment?.hasLabel || ['shipped', 'delivered', 'cancelled'].includes(row.status)) return null;
  return row.shipment.packed ? (
    <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-emerald-800" title={t('Packed; it moves to Shipped once the tracking has reached the marketplace')}>
      {t('Packed')}
    </span>
  ) : (
    <span className="rounded-full bg-sky-tint px-2 py-0.5 text-[11px] font-medium whitespace-nowrap text-sky-ink" title={t('The label is made. The order stays here until you press Packed')}>
      {t('Label ready')}
    </span>
  );
}

export function OrdersTable({
  rows,
  selectedId,
  users,
  statuses,
}: {
  rows: OrderRow[];
  selectedId: string | null;
  users: { id: string; name: string }[];
  statuses: { value: string; label: string }[];
}) {
  const t = useT();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const ids = [...checked].join(',');
  const labelIds = useMemo(() => rows.filter((r) => checked.has(r.id) && r.shipment?.hasLabel).map((r) => r.shipment!.id), [rows, checked]);

  const sheet = useOrderSheet();
  const open = (id: string) => {
    // On a phone the details slide up at once; the provider also updates the address.
    if (sheet) return sheet.show(id);
    const next = new URLSearchParams(searchParams.toString());
    next.set('order', id);
    router.push(`${pathname}?${next}`, { scroll: false });
  };
  const toggle = (id: string) =>
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (rows.length === 0) return <EmptyState title={t('No orders match these filters')}>{t('New orders appear here after the next sync.')}</EmptyState>;

  return (
    <>
      {checked.size > 0 && (
        // A floating bar that stays in view while the list scrolls under it.
        <div className="sticky top-[calc(3.75rem+env(safe-area-inset-top))] z-20 m-2 flex flex-wrap items-center gap-3 rounded-3xl border border-black/[0.08] bg-white/95 px-4 py-2.5 shadow-[0_12px_32px_-12px_rgba(28,27,25,0.3)] backdrop-blur md:top-4 md:rounded-full">
          <span className="text-sm font-medium text-ink">{t('{n} selected', { n: checked.size })}</span>
          <ActionForm action={bulkCreateLabelsAction} showOk={false}>
            <input type="hidden" name="ids" value={ids} />
            <SubmitButton size="sm" pendingText={t('Queuing labels…')}>
              <Truck className="size-3.5" /> {t('Generate labels')}
            </SubmitButton>
          </ActionForm>
          {labelIds.length > 0 && (
            <PrintLabelButton className={buttonClass('secondary', 'sm')} href={`/api/labels/merged?shipments=${labelIds.join(',')}`}>
              <Printer className="size-3.5" /> {t.plural(labelIds.length, 'Print {n} label', 'Print {n} labels')}
            </PrintLabelButton>
          )}
          <ActionForm action={bulkStatusAction} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={ids} />
            <Select name="status" className="h-8 w-40 text-xs" defaultValue="">
              <option value="" disabled>
                {t('Set status…')}
              </option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {t(s.label)}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary">
              {t('Apply')}
            </SubmitButton>
          </ActionForm>
          <ActionForm action={bulkAssignAction} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={ids} />
            <Select name="assigneeId" className="h-8 w-36 text-xs" defaultValue="">
              <option value="">{t('Unassigned')}</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary">
              {t('Assign')}
            </SubmitButton>
          </ActionForm>
          <button className="ml-auto cursor-pointer rounded-full px-2 py-1 text-xs text-slate-600 hover:bg-black/[0.04] hover:text-ink" onClick={() => setChecked(new Set())}>
            {t('Clear selection')}
          </button>
        </div>
      )}
      {/* Phones: one card per order. The whole card opens the details; the checkbox has its own 44 pt target. */}
      <div className="md:hidden">
        <label className="flex min-h-11 items-center gap-3 px-1 text-xs font-medium text-slate-500">
          <input type="checkbox" className="size-5 rounded accent-ink" checked={allChecked} onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))} />
          {t('Select all on this page')}
        </label>
        <ul className="space-y-2">
          {rows.map((r) => (
            <li
              key={r.id}
              className={cn(
                'flex items-stretch overflow-hidden rounded-3xl border border-black/[0.06] bg-white',
                r.returning && 'shadow-[inset_3px_0_0_0_theme(colors.violet.500)]',
                checked.has(r.id) && 'border-ink/30 bg-sidebar',
              )}
            >
              <label className="flex w-12 shrink-0 items-center justify-center" aria-label={t('Select order {number}', { number: r.number })}>
                <input type="checkbox" className="size-5 rounded accent-ink" checked={checked.has(r.id)} onChange={() => toggle(r.id)} />
              </label>
              <button type="button" onClick={() => open(r.id)} className="press min-w-0 flex-1 py-3.5 pr-4 text-left active:bg-slate-900/[0.04]">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-base font-semibold text-ink">{r.buyer}</span>
                  <span className="shrink-0 text-base font-medium tabular-nums">{formatMoney(r.total, r.currency)}</span>
                </span>
                {r.products.length > 0 && (
                  <span className="mt-1 line-clamp-2 text-xs text-slate-600">{r.products.map((p) => (p.quantity > 1 ? `${p.quantity}× ${p.name}` : p.name)).join(' · ')}</span>
                )}
                <span className="mt-1.5 flex items-center gap-2 text-sm text-slate-500">
                  <MarketplaceBadge marketplace={r.marketplace} />
                  <span className="truncate">
                    {r.number} · {shortDate(r.placedAt, t.locale)}
                  </span>
                </span>
                <span className="mt-2 flex flex-wrap items-center gap-1.5">
                  <StatusBadge status={r.status} />
                  <LabelChip row={r} />
                  {r.cod && <span className="rounded-full bg-peach-tint px-2 py-0.5 text-xs font-medium text-peach-ink">{t('COD')}</span>}
                  {r.returning && <span className="rounded-full bg-violet-50 px-2 py-0.5 text-xs font-medium text-violet-800">{t('Returning · {ordinal}', { ordinal: ordinal(r.returning.orderNumber, t.locale) })}</span>}
                  {r.notes && (
                    <span
                      className={cn(
                        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
                        r.notes.important > 0 ? 'bg-butter/60 text-butter-ink' : 'bg-black/[0.05] text-slate-600',
                      )}
                      aria-label={notesLabel(r.notes, t)}
                    >
                      <MessageSquareText className="size-3" aria-hidden /> {r.notes.count}
                    </span>
                  )}
                  {!r.readyToShip && r.status !== 'cancelled' && <span className="text-xs text-amber-700">{t('Awaiting marketplace')}</span>}
                  {r.shipment?.state === 'failed' && <span className="text-xs text-red-700">{t('Label failed')}</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="hidden overflow-x-auto md:block">
        <table className="min-w-full">
          <thead className="border-b border-black/[0.06]">
            <tr>
              <th className={cn(th, 'w-10 pl-5')}>
                <input
                  type="checkbox"
                  aria-label={t('Select all')}
                  className="size-4 rounded accent-ink"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th className={th}>{t('Date')}</th>
              <th className={th}>{t('Products')}</th>
              <th className={th}>{t('Customer')}</th>
              <th className={th}>{t('Source')}</th>
              <th className={cn(th, 'hidden 2xl:table-cell')}>{t('Courier')}</th>
              <th className={th}>{t('Status')}</th>
              <th className={cn(th, 'pr-5 text-right')}>{t('Total')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const active = r.id === selectedId;
              return (
                <tr
                  key={r.id}
                  onClick={() => open(r.id)}
                  className={cn(
                    'cursor-pointer border-b border-black/[0.04] transition-colors last:border-0',
                    active ? 'bg-sidebar shadow-[inset_2px_0_0_0_var(--color-ink)]' : checked.has(r.id) ? 'bg-sidebar/70' : 'hover:bg-canvas',
                    !active && r.returning && 'shadow-[inset_3px_0_0_0_theme(colors.violet.500)]',
                  )}
                >
                  <td className={cn(td, 'pl-5')} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={t('Select order {number}', { number: r.number })}
                      className="size-4 rounded accent-ink"
                      checked={checked.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className={cn(td, 'whitespace-nowrap')} title={r.number}>
                    <div className="text-ink tabular-nums">{shortDay(r.placedAt, t.locale)}</div>
                    <div className="text-xs text-slate-500 tabular-nums">{shortTime(r.placedAt, t.locale)}</div>
                  </td>
                  <td className={td}>
                    <ProductList products={r.products} />
                  </td>
                  <td className={td}>
                    <div className="flex min-w-44 max-w-72 flex-wrap items-center gap-x-1.5 gap-y-1 font-medium text-ink">
                      {r.customerId ? (
                        <Link
                          href={`/customers/${r.customerId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="whitespace-nowrap underline decoration-black/20 underline-offset-4 hover:decoration-ink"
                          title={t('Open customer')}
                        >
                          {r.buyer}
                        </Link>
                      ) : (
                        <span className="whitespace-nowrap">{r.buyer}</span>
                      )}
                      {r.returning && (
                        <span
                          className="rounded-full bg-violet-50 px-2 py-0.5 text-[11px] font-medium text-violet-800"
                          title={t('{ordinal} order · first ordered {date}', { ordinal: ordinal(r.returning.orderNumber, t.locale), date: sinceLabel(r.returning.since, t.locale) })}
                        >
                          {t('Returning · {ordinal}', { ordinal: ordinal(r.returning.orderNumber, t.locale) })}
                        </span>
                      )}
                      <LabelChip row={r} />
                      {r.notes && (
                        <span
                          className={cn(
                            'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[11px] font-medium',
                            r.notes.important > 0 ? 'bg-butter/60 text-butter-ink' : 'bg-black/[0.05] text-slate-600',
                          )}
                          title={notesLabel(r.notes, t)}
                          aria-label={notesLabel(r.notes, t)}
                        >
                          <MessageSquareText className="size-3" aria-hidden />
                          {r.notes.count}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 text-xs whitespace-nowrap text-slate-500">
                      {r.city} · {t.plural(r.itemCount, '{n} item', '{n} items')}
                    </div>
                  </td>
                  <td className={td}>
                    <MarketplaceBadge marketplace={r.marketplace} />
                  </td>
                  <td className={cn(td, 'hidden 2xl:table-cell')}>
                    <span className="line-clamp-2 w-40 text-slate-600" title={r.courier ?? undefined}>
                      {r.courier ?? <span className="text-slate-400">—</span>}
                    </span>
                  </td>
                  <td className={td}>
                    <StatusBadge status={r.status} />
                    {!r.readyToShip && r.status !== 'cancelled' && <div className="mt-1 text-[11px] text-amber-700">{t('Awaiting marketplace')}</div>}
                    {r.shipment?.state === 'failed' && <div className="mt-1 text-[11px] text-red-700">{t('Label failed')}</div>}
                  </td>
                  <td className={cn(td, 'pr-5 text-right font-medium whitespace-nowrap tabular-nums text-ink')}>
                    {formatMoney(r.total, r.currency)}
                    {r.cod && <div className="text-[11px] font-medium text-peach-ink">{t('COD')}</div>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
