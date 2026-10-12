'use client';

import { Printer, Truck } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMemo, useState } from 'react';
import { MarketplaceBadge, StatusBadge } from '@/components/badges';
import { PrintLabelButton } from '@/components/print-label-button';
import { ActionForm, SubmitButton } from '@/components/forms';
import { buttonClass, EmptyState, Select } from '@/components/ui';
import { cn, formatMoney, ordinal } from '@/lib/utils';
import type { OrderStatus } from '@/server/db/schema';
import { bulkAssignAction, bulkCreateLabelsAction, bulkStatusAction } from './actions';

export interface OrderRow {
  id: string;
  number: string;
  marketplace: string;
  accountName: string;
  placedAt: string;
  buyer: string;
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
  shipment: { id: string; state: string; trackingNumber: string | null; carrier: string; hasLabel: boolean } | null;
}

const th = 'px-3 py-3 text-left text-xs font-medium text-slate-500';
const td = 'px-3 py-3.5 text-sm';

function shortDate(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
}

function sinceLabel(iso: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Europe/Warsaw' }).format(new Date(iso));
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
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const allChecked = rows.length > 0 && rows.every((r) => checked.has(r.id));
  const ids = [...checked].join(',');
  const labelIds = useMemo(() => rows.filter((r) => checked.has(r.id) && r.shipment?.hasLabel).map((r) => r.shipment!.id), [rows, checked]);

  const open = (id: string) => {
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

  if (rows.length === 0) return <EmptyState title="No orders match these filters">New orders appear here after the next sync.</EmptyState>;

  return (
    <>
      {checked.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 border-b border-brand-100 bg-brand-50 px-5 py-2.5">
          <span className="text-sm font-medium text-brand-700">{checked.size} selected</span>
          <ActionForm action={bulkCreateLabelsAction} showOk={false}>
            <input type="hidden" name="ids" value={ids} />
            <SubmitButton size="sm" pendingText="Queuing labels…">
              <Truck className="size-3.5" /> Generate labels
            </SubmitButton>
          </ActionForm>
          {labelIds.length > 0 && (
            <PrintLabelButton className={buttonClass('secondary', 'sm')} href={`/api/labels/merged?shipments=${labelIds.join(',')}`}>
              <Printer className="size-3.5" /> Print {labelIds.length} label(s)
            </PrintLabelButton>
          )}
          <ActionForm action={bulkStatusAction} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={ids} />
            <Select name="status" className="h-8 w-40 text-xs" defaultValue="">
              <option value="" disabled>
                Set status…
              </option>
              {statuses.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary">
              Apply
            </SubmitButton>
          </ActionForm>
          <ActionForm action={bulkAssignAction} className="flex items-center gap-1.5">
            <input type="hidden" name="ids" value={ids} />
            <Select name="assigneeId" className="h-8 w-36 text-xs" defaultValue="">
              <option value="">Unassigned</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </Select>
            <SubmitButton size="sm" variant="secondary">
              Assign
            </SubmitButton>
          </ActionForm>
          <button className="ml-auto text-xs text-brand-700 hover:underline" onClick={() => setChecked(new Set())}>
            Clear selection
          </button>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <thead className="border-b border-slate-100">
            <tr>
              <th className={cn(th, 'w-10 pl-5')}>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  className="size-4 rounded accent-brand-600"
                  checked={allChecked}
                  onChange={() => setChecked(allChecked ? new Set() : new Set(rows.map((r) => r.id)))}
                />
              </th>
              <th className={th}>Order #</th>
              <th className={th}>Customer</th>
              <th className={th}>Source</th>
              <th className={cn(th, 'hidden 2xl:table-cell')}>Courier</th>
              <th className={cn(th, 'hidden 2xl:table-cell')}>Date</th>
              <th className={th}>Status</th>
              <th className={cn(th, 'pr-5 text-right')}>Total</th>
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
                    'cursor-pointer border-b border-slate-50 transition-colors last:border-0',
                    active ? 'bg-brand-50/70' : checked.has(r.id) ? 'bg-slate-50' : r.returning ? 'bg-violet-50/60 hover:bg-violet-50' : 'hover:bg-slate-50/70',
                    r.returning && 'shadow-[inset_3px_0_0_0_theme(colors.violet.500)]',
                  )}
                >
                  <td className={cn(td, 'pl-5')} onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      aria-label={`Select order ${r.number}`}
                      className="size-4 rounded accent-brand-600"
                      checked={checked.has(r.id)}
                      onChange={() => toggle(r.id)}
                    />
                  </td>
                  <td className={cn(td, 'font-medium whitespace-nowrap', active && 'text-brand-700')}>
                    {r.number}
                    <div className="text-xs font-normal text-slate-400 2xl:hidden">{shortDate(r.placedAt)}</div>
                  </td>
                  <td className={td}>
                    <div className="flex items-center gap-1.5 font-medium whitespace-nowrap text-slate-800">
                      {r.buyer}
                      {r.returning && (
                        <span
                          className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] font-semibold text-violet-800"
                          title={`${ordinal(r.returning.orderNumber)} order · first ordered ${sinceLabel(r.returning.since)}`}
                        >
                          Returning · {ordinal(r.returning.orderNumber)}
                        </span>
                      )}
                    </div>
                    <div className="text-xs whitespace-nowrap text-slate-400">
                      {r.city} · {r.itemCount} item{r.itemCount === 1 ? '' : 's'}
                    </div>
                  </td>
                  <td className={td}>
                    <MarketplaceBadge marketplace={r.marketplace} />
                  </td>
                  <td className={cn(td, 'hidden max-w-40 truncate text-slate-600 2xl:table-cell')} title={r.courier ?? undefined}>
                    {r.courier ?? <span className="text-slate-300">—</span>}
                  </td>
                  <td className={cn(td, 'hidden whitespace-nowrap text-slate-600 2xl:table-cell')}>{shortDate(r.placedAt)}</td>
                  <td className={td}>
                    <StatusBadge status={r.status} />
                    {!r.readyToShip && r.status !== 'cancelled' && <div className="mt-1 text-[11px] text-amber-700">Awaiting marketplace</div>}
                    {r.shipment?.state === 'failed' && <div className="mt-1 text-[11px] text-red-700">Label failed</div>}
                  </td>
                  <td className={cn(td, 'pr-5 text-right font-medium whitespace-nowrap tabular-nums')}>
                    {formatMoney(r.total, r.currency)}
                    {r.cod && <div className="text-[11px] font-medium text-orange-700">COD</div>}
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
