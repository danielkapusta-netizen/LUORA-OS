'use client';

import { AlertCircle, CheckCircle2, Clock3, PackageCheck, Truck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { AutoRefresh } from '@/components/auto-refresh';
import { Badge, buttonClass, Card, type Tone } from '@/components/ui';
import { useT } from '@/lib/i18n/client';
import type { T } from '@/lib/i18n/translate';
import type { PickupCourier } from '@/lib/pickup-slots';
import { dayLabel, timeRange } from '@/lib/tasks/dates';
import { cn } from '@/lib/utils';
import { BookingDialog, type BookingGroup } from './booking-dialog';

export interface BoardParcel {
  shipmentId: string;
  orderNumber: string;
  buyer: string;
  carrierName: string;
  packed: boolean;
  labelAt: string;
  trackingNumber: string | null;
}

export interface BoardPickup {
  id: string;
  state: 'pending' | 'booked' | 'failed';
  pickupDate: string;
  minTime: string | null;
  maxTime: string | null;
  carrierPickupId: string | null;
  addressLabel: string;
  error: string | null;
  parcels: number;
}

export interface BoardColumn {
  courier: PickupCourier;
  parcels: BoardParcel[];
  pickups: BoardPickup[];
}

export interface BoardAddress {
  id: string;
  label: string;
  line: string;
  isDefault: boolean;
}

/** Each courier keeps one pastel, so a column is recognised before its name is read. */
const TONES: Record<PickupCourier, Tone> = { 'ORLEN Paczka': 'peach', InPost: 'butter', DPD: 'blush', DHL: 'sky' };
const MONOGRAM: Record<Tone, string> = {
  peach: 'bg-peach text-peach-ink',
  butter: 'bg-butter text-butter-ink',
  blush: 'bg-blush text-blush-ink',
  sky: 'bg-sky text-sky-ink',
};

/** "Today 14:20", "Yesterday 16:05", "Fri, 31 Oct 09:12" in Warsaw time. */
function labelTime(iso: string, now: string, t: T): string {
  const date = new Date(iso);
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Warsaw', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(date);
  return `${dayLabel(day, now, t)} ${time}`;
}

export function PickupBoard({ columns, otherCouriers, addresses, today }: { columns: BoardColumn[]; otherCouriers: number; addresses: BoardAddress[]; today: string }) {
  const t = useT();
  // Every packed parcel starts ticked: in the morning one press books them all.
  const [selected, setSelected] = useState<Set<string>>(() => new Set(columns.flatMap((c) => c.parcels.filter((p) => p.packed).map((p) => p.shipmentId))));
  const [dialog, setDialog] = useState<BookingGroup[] | null>(null);

  // Parcels that left the list (booked elsewhere, refreshed away) drop out of the selection.
  const live = useMemo(() => new Set(columns.flatMap((c) => c.parcels.filter((p) => p.packed).map((p) => p.shipmentId))), [columns]);
  const ticked = (c: BoardColumn) => c.parcels.filter((p) => p.packed && selected.has(p.shipmentId) && live.has(p.shipmentId)).map((p) => p.shipmentId);
  const groups: BookingGroup[] = columns.map((c) => ({ courier: c.courier, shipmentIds: ticked(c) })).filter((g) => g.shipmentIds.length > 0);
  const total = groups.reduce((n, g) => n + g.shipmentIds.length, 0);
  const pending = columns.some((c) => c.pickups.some((p) => p.state === 'pending'));

  const toggle = (ids: string[], on: boolean) =>
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });

  return (
    <>
      <AutoRefresh active={pending} />
      {/* The morning action: what is ticked, and one button for every courier at once. */}
      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-3xl border border-black/[0.06] bg-white px-4 py-3 md:px-5">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-sidebar text-ink">
          <PackageCheck className="size-5" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-ink" aria-live="polite">
            {live.size === 0 ? t('No packed parcels waiting') : total === 0 ? t('Nothing ticked') : t.plural(total, '{n} parcel ticked', '{n} parcels ticked')}
            {groups.length > 1 && <span className="text-slate-500"> · {t.plural(groups.length, '{n} courier', '{n} couriers')}</span>}
          </p>
          <p className="text-xs text-slate-500">{t('Packed parcels are ticked for you. Unpacked ones wait until they are marked packed.')}</p>
        </div>
        {live.size > 0 && (
        <button
          type="button"
          disabled={total === 0}
          onClick={() => setDialog(groups)}
          className={cn(
            buttonClass('primary'),
            'bg-gradient-to-br from-[#0f7a50] to-[#0b5e3e] hover:from-[#0b5e3e] hover:to-[#0b5e3e] max-sm:w-full',
          )}
        >
          <Truck className="size-4" aria-hidden />
          {groups.length > 1 ? t('Book all pickups') : t('Book pickup')}
        </button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 2xl:grid-cols-4">
        {columns.map((column) => (
          <CourierColumn
            key={column.courier}
            column={column}
            selected={selected}
            today={today}
            onToggle={toggle}
            onBook={(ids) => setDialog([{ courier: column.courier, shipmentIds: ids }])}
            ticked={ticked(column)}
          />
        ))}
      </div>

      {otherCouriers > 0 && (
        <p className="mt-4 text-center text-xs text-slate-500">
          {t.plural(otherCouriers, '{n} other parcel (Allegro One, Pocztex…) is not listed: those couriers are not booked from here.', '{n} other parcels (Allegro One, Pocztex…) are not listed: those couriers are not booked from here.')}
        </p>
      )}

      <BookingDialog groups={dialog} addresses={addresses} onClose={() => setDialog(null)} />
    </>
  );
}

function CourierColumn({
  column,
  selected,
  ticked,
  today,
  onToggle,
  onBook,
}: {
  column: BoardColumn;
  selected: Set<string>;
  ticked: string[];
  today: string;
  onToggle: (ids: string[], on: boolean) => void;
  onBook: (ids: string[]) => void;
}) {
  const t = useT();
  const tone = TONES[column.courier];
  const packed = column.parcels.filter((p) => p.packed).map((p) => p.shipmentId);
  const allOn = packed.length > 0 && packed.every((id) => selected.has(id));
  const headingId = `courier-${tone}`;

  return (
    <Card tone={tone} className="flex flex-col p-3 md:p-4" aria-labelledby={headingId}>
      <div className="flex items-center gap-3 px-1 pb-3">
        <span className={cn('flex size-10 shrink-0 items-center justify-center rounded-2xl text-sm font-bold', MONOGRAM[tone])} aria-hidden>
          {column.courier.slice(0, 1)}
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="truncate text-base font-semibold text-ink">
            {column.courier}
          </h2>
          <p className="text-xs text-slate-600">{column.parcels.length === 0 ? t('Nothing waiting') : t.plural(column.parcels.length, '{n} parcel waiting', '{n} parcels waiting')}</p>
        </div>
        {packed.length > 1 && (
          <label className="press flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-2 text-xs font-medium text-slate-700 hover:bg-white/60">
            <input type="checkbox" className="size-4 accent-ink" checked={allOn} onChange={(e) => onToggle(packed, e.target.checked)} />
            {t('All')}
          </label>
        )}
      </div>

      {column.parcels.length > 0 ? (
        <ul className="space-y-1.5" aria-label={t('Parcels for {courier}', { courier: column.courier })}>
          {column.parcels.map((p) => (
            <li key={p.shipmentId}>
              <label
                className={cn(
                  'flex min-h-14 items-center gap-3 rounded-2xl border bg-white px-3 py-2 transition-[border-color,box-shadow] duration-150',
                  p.packed ? 'press cursor-pointer border-black/[0.05] hover:border-black/15 has-[:checked]:border-ink/40 has-[:checked]:shadow-[0_1px_0_rgba(28,27,25,0.04)]' : 'cursor-default border-transparent bg-white/55',
                )}
              >
                <input
                  type="checkbox"
                  className="size-[18px] shrink-0 accent-ink disabled:opacity-40"
                  checked={p.packed && selected.has(p.shipmentId)}
                  disabled={!p.packed}
                  onChange={(e) => onToggle([p.shipmentId], e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate font-mono text-[13px] font-medium tabular-nums', p.packed ? 'text-ink' : 'text-slate-600')}>{p.orderNumber}</span>
                  <span className="block truncate text-xs text-slate-500">{p.buyer}</span>
                </span>
                {p.packed ? (
                  <span className="shrink-0 text-right font-mono text-[11px] text-slate-500 tabular-nums">{labelTime(p.labelAt, today, t)}</span>
                ) : (
                  <Badge tone="gray" className="shrink-0">
                    {t('Not packed')}
                  </Badge>
                )}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <p className="rounded-2xl bg-white/55 px-3 py-6 text-center text-sm text-slate-600">{t('No parcels need this courier.')}</p>
      )}

      {/* Only packed parcels can be booked, so a column without any has no button to press. */}
      {packed.length > 0 && (
        <div className="mt-auto pt-3">
          <button type="button" disabled={ticked.length === 0} onClick={() => onBook(ticked)} className={cn(buttonClass('primary'), 'w-full')}>
            {ticked.length > 0 ? t.plural(ticked.length, 'Book pickup · {n} parcel', 'Book pickup · {n} parcels') : t('Book pickup')}
          </button>
        </div>
      )}

      {column.pickups.length > 0 && (
        <ul className="mt-3 space-y-1.5" aria-label={t('Pickups for {courier}', { courier: column.courier })}>
          {column.pickups.map((p) => (
            <PickupRow key={p.id} pickup={p} today={today} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function PickupRow({ pickup: p, today }: { pickup: BoardPickup; today: string }) {
  const t = useT();
  const state = {
    pending: { icon: Clock3, text: t('Booking…'), className: 'text-amber-700' },
    booked: { icon: CheckCircle2, text: t('Booked'), className: 'text-emerald-700' },
    failed: { icon: AlertCircle, text: t('Not booked'), className: 'text-red-700' },
  }[p.state];
  const Icon = state.icon;
  return (
    <li className="rounded-2xl bg-white/70 px-3 py-2.5 text-xs">
      <div className="flex items-center gap-2">
        <Icon className={cn('size-4 shrink-0', state.className)} aria-hidden />
        <span className={cn('font-semibold', state.className)}>{state.text}</span>
        <span className="text-slate-600">· {dayLabel(p.pickupDate, today, t)}</span>
        {timeRange(p.minTime, p.maxTime) && <span className="font-mono text-slate-600 tabular-nums">{timeRange(p.minTime, p.maxTime)}</span>}
      </div>
      <p className="mt-0.5 pl-6 text-slate-500">
        {t.plural(p.parcels, '{n} parcel', '{n} parcels')} · {p.addressLabel}
        {p.carrierPickupId && (
          <>
            {' · '}
            <span className="font-mono text-slate-700">{p.carrierPickupId}</span>
          </>
        )}
      </p>
      {p.state === 'failed' && p.error && <PickupError text={t(p.error)} />}
      {p.state === 'failed' && <p className="mt-0.5 pl-6 text-slate-500">{t('Its parcels are back in the list to book again.')}</p>}
    </li>
  );
}

/** Allegro's refusals are long and full of ids: the first sentence, with the rest folded away. */
function PickupError({ text }: { text: string }) {
  const t = useT();
  const first = text.match(/^.+?[.!?](?=\s|$)/)?.[0] ?? text;
  const short = first.length > 160 ? `${first.slice(0, 157)}…` : first;
  return (
    <div className="mt-1 pl-6 text-red-700">
      <p>{short}</p>
      {short !== text && (
        <details className="mt-0.5">
          <summary className="cursor-pointer text-slate-500 hover:text-ink">{t('Details')}</summary>
          <p className="mt-1 break-words text-slate-600">{text}</p>
        </details>
      )}
    </div>
  );
}
