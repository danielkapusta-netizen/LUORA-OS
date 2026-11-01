'use client';

import { AlertCircle, Check, CheckCircle2, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { DynamicButton } from '@/components/dynamic-button';
import { buttonClass, Field, Select } from '@/components/ui';
import { useT } from '@/lib/i18n/client';
import { parseSlotKey, slotKey, type PickupCourier, type Slot } from '@/lib/pickup-slots';
import { dayLabel, today } from '@/lib/tasks/dates';
import { cn } from '@/lib/utils';
import { bookPickupAction, proposalsAction } from './actions';
import type { BoardAddress } from './pickup-board';

export interface BookingGroup {
  courier: PickupCourier;
  shipmentIds: string[];
}

type Proposal = Awaited<ReturnType<typeof proposalsAction>>;
type Offered = Extract<Proposal, { slots: Slot[] }>;

const resultKey = (addressId: string, g: BookingGroup) => `${addressId}|${g.courier}|${g.shipmentIds.join(',')}`;

/** Slots grouped by day, in the order the carrier proposed them. */
function byDay(slots: Slot[]): [string, Slot[]][] {
  const days = new Map<string, Slot[]>();
  for (const slot of slots) days.set(slot.date, [...(days.get(slot.date) ?? []), slot]);
  return [...days.entries()];
}

/**
 * The centred booking dialog. It asks the carrier for pickup windows as it opens (and again when the
 * address changes), preselects the earliest window for each courier, and books them all with one
 * press: the button turns green and the dialog closes. "Book all" passes one group per courier.
 */
export function BookingDialog({ groups, addresses, onClose }: { groups: BookingGroup[] | null; addresses: BoardAddress[]; onClose: () => void }) {
  const t = useT();
  const ref = useRef<HTMLDialogElement>(null);
  const requested = useRef(new Set<string>());
  const [addressId, setAddressId] = useState(() => (addresses.find((a) => a.isDefault) ?? addresses[0])?.id ?? '');
  const [results, setResults] = useState<Record<string, Proposal>>({});
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [booked, setBooked] = useState<Set<PickupCourier>>(new Set());
  const [phase, setPhase] = useState<'idle' | 'booking' | 'done'>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (groups && !dialog.open) dialog.showModal();
    if (!groups && dialog.open) dialog.close();
  }, [groups]);

  // Ask for windows once per courier, parcels and address.
  useEffect(() => {
    if (!groups || !addressId) return;
    for (const g of groups) {
      const key = resultKey(addressId, g);
      if (requested.current.has(key)) continue;
      requested.current.add(key);
      proposalsAction(g.shipmentIds, addressId).then((result) => setResults((prev) => ({ ...prev, [key]: result })));
    }
  }, [groups, addressId]);

  /** Fresh windows next time: what the carrier offers changes during the day. */
  function reset() {
    requested.current.clear();
    setResults({});
    setChosen({});
    setBooked(new Set());
    setPhase('idle');
    setError(null);
    onClose();
  }

  if (!addresses.length) return null;
  const list = groups ?? [];
  const rows = list.map((g) => {
    const key = resultKey(addressId, g);
    const result = results[key];
    const ok: Offered | null = result && !result.error ? (result as Offered) : null;
    const pick = chosen[key] ?? (ok?.slots[0] ? slotKey(ok.slots[0]) : null);
    const ids = ok ? g.shipmentIds.filter((id) => !ok.unavailable.includes(id)) : [];
    return { g, key, result, ok, pick, ids, bookable: Boolean(ok && pick && ids.length && !booked.has(g.courier)) };
  });
  const loading = rows.some((r) => !r.result);
  const toBook = rows.filter((r) => r.bookable);
  const parcels = list.reduce((n, g) => n + g.shipmentIds.length, 0);

  async function book() {
    setPhase('booking');
    setError(null);
    const failures: string[] = [];
    for (const r of toBook) {
      const slot = parseSlotKey(r.pick!)!;
      const result = await bookPickupAction({ courier: r.g.courier, shipmentIds: r.ids, addressId, slot });
      if (result?.error) failures.push(list.length > 1 ? `${r.g.courier}: ${result.error}` : result.error);
      else setBooked((prev) => new Set(prev).add(r.g.courier));
    }
    if (failures.length) {
      setPhase('idle');
      setError(failures.join('\n'));
      return;
    }
    setPhase('done');
    // A moment in green, so the booking is seen before the dialog goes.
    await new Promise((resolve) => setTimeout(resolve, 700));
    ref.current?.close();
  }

  const title = list.length > 1 ? t('Book pickups') : list[0] ? t('Book {courier} pickup', { courier: list[0].courier }) : t('Book pickup');
  const label =
    phase === 'booking' ? t('Booking…') : phase === 'done' ? t('Booked') : toBook.length > 1 ? t('Book {n} pickups', { n: toBook.length }) : t('Book pickup');

  return (
    <dialog
      ref={ref}
      aria-labelledby="pickup-dialog-title"
      onClose={reset}
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === ref.current && phase !== 'booking') ref.current.close();
      }}
      className={cn(
        'm-auto max-h-[min(90dvh,46rem)] w-[min(34rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-3xl border border-black/5 bg-white p-0 text-ink shadow-2xl open:flex',
        'backdrop:bg-slate-900/40 backdrop:backdrop-blur-[2px]',
        // Arrives from slightly smaller and fades in, like a sheet settling; reduced motion keeps only the fade.
        'transition-[opacity,scale] duration-200 ease-out starting:open:scale-[0.97] starting:open:opacity-0 motion-reduce:transition-opacity motion-reduce:starting:open:scale-100',
      )}
    >
      <header className="flex items-start gap-3 border-b border-black/[0.06] px-5 pt-5 pb-4">
        <div className="min-w-0 flex-1">
          <h2 id="pickup-dialog-title" className="font-display text-2xl leading-tight font-semibold tracking-tight">
            {title}
          </h2>
          <p className="mt-0.5 text-sm text-slate-500">{t.plural(parcels, '{n} parcel', '{n} parcels')}</p>
        </div>
        <button
          type="button"
          onClick={() => ref.current?.close()}
          disabled={phase === 'booking'}
          aria-label={t('Close')}
          className="press -mt-1 -mr-2 flex size-11 cursor-pointer items-center justify-center rounded-full text-slate-500 hover:bg-black/[0.05] hover:text-ink"
        >
          <X className="size-5" aria-hidden />
        </button>
      </header>

      <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
        <Field label={t('Pickup from')}>
          <Select value={addressId} onChange={(e) => setAddressId(e.target.value)} disabled={phase !== 'idle'}>
            {addresses.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label} – {a.line}
              </option>
            ))}
          </Select>
        </Field>

        {rows.map(({ g, key, result, ok, pick, bookable }) => (
          <section key={g.courier} aria-labelledby={`slots-${key}`} className="space-y-2.5">
            {list.length > 1 && (
              <h3 id={`slots-${key}`} className="flex items-center gap-2 text-sm font-semibold">
                {booked.has(g.courier) && <CheckCircle2 className="size-4 text-emerald-600" aria-label={t('Booked')} />}
                {g.courier}
                <span className="font-normal text-slate-500">· {t.plural(g.shipmentIds.length, '{n} parcel', '{n} parcels')}</span>
              </h3>
            )}
            {list.length === 1 && (
              <h3 id={`slots-${key}`} className="text-xs font-medium text-slate-600">
                {t('When should the courier come?')}
              </h3>
            )}

            {!result ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3" aria-busy="true" aria-label={t('Asking the courier for times…')}>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-12 animate-pulse rounded-2xl bg-slate-900/[0.05] motion-reduce:animate-none" />
                ))}
              </div>
            ) : result.error ? (
              <p className="flex gap-2 rounded-2xl bg-red-50 px-3 py-2.5 text-sm text-red-800">
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                {result.error}
              </p>
            ) : ok && ok.slots.length === 0 ? (
              <p className="rounded-2xl bg-amber-50 px-3 py-2.5 text-sm text-amber-900">{t('The courier offers no pickup for these parcels. Drop them off at a point instead.')}</p>
            ) : (
              ok && (
                <fieldset disabled={!bookable || phase !== 'idle'} className="space-y-3">
                  <legend className="sr-only">{t('Pickup time for {courier}', { courier: g.courier })}</legend>
                  {byDay(ok.slots).map(([day, slots]) => (
                    <div key={day}>
                      <p className="mb-1.5 text-xs font-medium text-slate-600">{dayLabel(day, today(), t)}</p>
                      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                        {slots.map((slot) => {
                          const value = slotKey(slot);
                          return (
                            <label
                              key={value}
                              className={cn(
                                'press flex min-h-12 cursor-pointer items-center justify-center gap-1.5 rounded-2xl border border-black/[0.08] bg-white px-3 text-sm transition-colors duration-150',
                                'hover:border-black/20 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-white',
                                'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink',
                              )}
                            >
                              <input
                                type="radio"
                                name={`slot-${key}`}
                                value={value}
                                checked={pick === value}
                                onChange={() => setChosen((prev) => ({ ...prev, [key]: value }))}
                                className="sr-only"
                              />
                              {pick === value && <Check className="size-3.5" strokeWidth={3} aria-hidden />}
                              {slot.minTime && slot.maxTime ? (
                                <span className="font-mono tabular-nums">
                                  {slot.minTime}–{slot.maxTime}
                                </span>
                              ) : (
                                <span>{t('During the day')}</span>
                              )}
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                  {ok.dateOnly && <p className="text-xs text-slate-500">{t('InPost gives no set hours: the courier comes on its round that day.')}</p>}
                  {ok.unavailable.length > 0 && (
                    <p className="text-xs text-amber-800">
                      {t.plural(ok.unavailable.length, '{n} parcel can’t be collected by this courier: drop it off at a point.', '{n} parcels can’t be collected by this courier: drop them off at a point.')}
                    </p>
                  )}
                </fieldset>
              )
            )}
          </section>
        ))}

        {error && (
          <p role="alert" className="flex gap-2 rounded-2xl bg-red-50 px-3 py-2.5 text-sm whitespace-pre-line text-red-800">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
        )}
        <p className="text-xs text-slate-500">{t('A booked pickup can only be cancelled with the courier directly.')}</p>
      </div>

      <footer className="flex items-center justify-end gap-2 border-t border-black/[0.06] px-5 py-3.5">
        <button type="button" onClick={() => ref.current?.close()} disabled={phase === 'booking'} className={buttonClass('ghost')}>
          {t('Cancel')}
        </button>
        <DynamicButton
          onClick={book}
          disabled={phase !== 'idle' || loading || toBook.length === 0}
          variant={phase === 'done' ? 'success' : 'primary'}
          stateKey={phase}
          icon={phase === 'done' ? <Check className="size-[15px]" strokeWidth={3} aria-hidden /> : undefined}
        >
          {label}
        </DynamicButton>
      </footer>
    </dialog>
  );
}
