// Courier pickup helpers shared by the server and the Courier pickup page.
import { courierOf, type Courier } from './couriers';
import { addDays, today, weekdayIndex } from './tasks/dates';

/** The couriers that get a column on the Courier pickup page, in the order staff read them. */
export const PICKUP_COURIERS = ['ORLEN Paczka', 'InPost', 'DPD', 'DHL'] as const satisfies readonly Courier[];
export type PickupCourier = (typeof PICKUP_COURIERS)[number];

export interface Slot {
  date: string;
  minTime?: string | null;
  maxTime?: string | null;
}

/** Allegro's carrier ids (shipment transportingInfo.carrierId) for when the delivery method names no courier. */
const CARRIER_CODES: [RegExp, PickupCourier][] = [
  [/^INPOST/i, 'InPost'],
  [/^DPD/i, 'DPD'],
  [/^DHL/i, 'DHL'],
  [/^ORLEN/i, 'ORLEN Paczka'],
];

/** Which pickup column a parcel belongs to, or null for couriers without one (Allegro One, Pocztex…). */
export function pickupCourierOf(deliveryMethodName: string | null | undefined, carrierCode: string | null | undefined): PickupCourier | null {
  const courier = courierOf(deliveryMethodName);
  if ((PICKUP_COURIERS as readonly string[]).includes(courier)) return courier as PickupCourier;
  if (courier !== 'Other') return null;
  for (const [pattern, c] of CARRIER_CODES) if (carrierCode && pattern.test(carrierCode)) return c;
  return null;
}

/** Monday to Friday. Public holidays are left to the carrier, which simply won't propose them. */
export function isWorkingDay(day: string): boolean {
  return weekdayIndex(day) < 5;
}

/** The next `count` working days after today (Warsaw), e.g. Friday → Monday, Tuesday. */
export function nextWorkingDays(now: Date, count: number, includeToday = false): string[] {
  const days: string[] = [];
  let day = includeToday ? today(now) : addDays(today(now), 1);
  while (days.length < count) {
    if (isWorkingDay(day)) days.push(day);
    day = addDays(day, 1);
  }
  return days;
}

/** Midnight in Warsaw at the start of `day`, as a moment. */
function warsawMidnight(day: string): Date {
  const utc = new Date(`${day}T00:00:00Z`);
  const offsetMs = new Date(utc.toLocaleString('en-US', { timeZone: 'Europe/Warsaw' })).getTime() - new Date(utc.toLocaleString('en-US', { timeZone: 'UTC' })).getTime();
  return new Date(utc.getTime() - offsetMs);
}

/**
 * Labels made since the start of the previous working day wait for a courier: yesterday and today,
 * and on a Monday also Friday and the weekend.
 */
export function pickupWindowStart(now: Date): Date {
  let day = addDays(today(now), -1);
  while (!isWorkingDay(day)) day = addDays(day, -1);
  return warsawMidnight(day);
}

/** After this hour (Warsaw) a same-day InPost pickup is no longer offered. */
export const SAME_DAY_CUTOFF_HOUR = 12;

function warsawHour(now: Date): number {
  return Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Warsaw', hour: '2-digit', hourCycle: 'h23' }).format(now));
}

/**
 * InPost through Allegro proposes no windows: the pickup is booked for a date and InPost comes
 * at its nearest round. Offer today (in the morning, on a working day) and the next working days.
 */
export function dateOnlySlots(now: Date, count = 3): Slot[] {
  const sameDay = isWorkingDay(today(now)) && warsawHour(now) < SAME_DAY_CUTOFF_HOUR;
  return nextWorkingDays(now, count, sameDay).map((date) => ({ date, minTime: null, maxTime: null }));
}

export function slotKey(slot: Slot): string {
  return `${slot.date}|${slot.minTime ?? ''}|${slot.maxTime ?? ''}`;
}

export function parseSlotKey(key: string): Slot | null {
  const [date, minTime, maxTime] = key.split('|');
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return { date, minTime: minTime || null, maxTime: maxTime || null };
}

/** The windows offered for every one of the parcels, earliest first (one pickup must suit them all). */
export function commonSlots(perParcel: Slot[][]): Slot[] {
  if (!perParcel.length) return [];
  const [first, ...rest] = perParcel;
  const shared = first.filter((slot) => rest.every((list) => list.some((s) => slotKey(s) === slotKey(slot))));
  const unique = [...new Map(shared.map((s) => [slotKey(s), s])).values()];
  return unique.sort((a, b) => slotKey(a).localeCompare(slotKey(b)));
}
