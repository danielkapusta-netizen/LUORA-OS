// Dates of the Tasks module. A "day" is a plain YYYY-MM-DD string in Warsaw time, and a time of day is HH:MM.
// Arithmetic runs in UTC on those strings, so daylight saving never moves a day.

const DAY_MS = 86_400_000;
export const TIME_ZONE = 'Europe/Warsaw';

export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const toDate = (day: string) => new Date(`${day}T00:00:00Z`);
const toDay = (date: Date) => date.toISOString().slice(0, 10);

/** A real calendar day written YYYY-MM-DD (2026-02-30 is not one). */
export function isDay(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = toDate(value);
  return !Number.isNaN(date.getTime()) && toDay(date) === value;
}

/** A time of day written HH:MM on the 24-hour clock. */
export function isTime(value: unknown): value is string {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

/** The calendar day of a moment, in Warsaw. */
export function dayOf(moment: Date): string {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(moment);
}

export function today(now: Date = new Date()): string {
  return dayOf(now);
}

export function addDays(day: string, n: number): string {
  return toDay(new Date(toDate(day).getTime() + n * DAY_MS));
}

/** Whole days from `from` to `to` (negative when `to` is earlier). */
export function daysBetween(from: string, to: string): number {
  return Math.round((toDate(to).getTime() - toDate(from).getTime()) / DAY_MS);
}

/** 0 = Monday … 6 = Sunday. */
export function weekdayIndex(day: string): number {
  return (toDate(day).getUTCDay() + 6) % 7;
}

export function weekStart(day: string): string {
  return addDays(day, -weekdayIndex(day));
}

/** The seven days (Monday first) of the week that contains `day`. */
export function weekDays(day: string): string[] {
  const start = weekStart(day);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export function monthStart(day: string): string {
  return `${day.slice(0, 7)}-01`;
}

/** The first day of the month `n` months from the one `day` is in. */
export function addMonths(day: string, n: number): string {
  const [year, month] = day.split('-').map(Number);
  const index = year * 12 + (month - 1) + n;
  return `${String(Math.floor(index / 12)).padStart(4, '0')}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

/** Weeks (Monday first) that cover the month of `day`, with the days of the neighbouring months that fill the first and last week. */
export function monthGrid(day: string): { day: string; inMonth: boolean }[][] {
  const month = day.slice(0, 7);
  const weeks: { day: string; inMonth: boolean }[][] = [];
  let cursor = weekStart(monthStart(day));
  while (cursor.slice(0, 7) <= month && weeks.length < 6) {
    weeks.push(Array.from({ length: 7 }, (_, i) => ({ day: addDays(cursor, i), inMonth: addDays(cursor, i).startsWith(month) })));
    cursor = addDays(cursor, 7);
  }
  return weeks;
}

export function dayParts(day: string): { num: string; weekday: string; month: string; year: number } {
  const date = toDate(day);
  return { num: String(date.getUTCDate()), weekday: WEEKDAYS[weekdayIndex(day)], month: MONTHS[date.getUTCMonth()], year: date.getUTCFullYear() };
}

/** "October 2026" */
export function monthTitle(day: string): string {
  return `${MONTH_NAMES[toDate(day).getUTCMonth()]} ${day.slice(0, 4)}`;
}

/** "14 Oct" (with the year when it is not this year's). */
export function shortDay(day: string, now: string = today()): string {
  const p = dayParts(day);
  return `${p.num} ${p.month}${day.slice(0, 4) === now.slice(0, 4) ? '' : ` ${p.year}`}`;
}

/** "Today", "Tomorrow", "Yesterday", otherwise "Tue, 14 Oct". */
export function dayLabel(day: string, now: string = today()): string {
  const diff = daysBetween(now, day);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  return `${dayParts(day).weekday}, ${shortDay(day, now)}`;
}

/** "10:30 – 12:30", or just the start. */
export function timeRange(start: string | null | undefined, end: string | null | undefined): string | null {
  if (start && end) return `${start} – ${end}`;
  return start || null;
}

/** An error message when the time slot is not valid, otherwise null. */
export function validateSlot(start: string | null | undefined, end: string | null | undefined): string | null {
  if (start && !isTime(start)) return 'Start time must look like 09:30';
  if (end && !isTime(end)) return 'End time must look like 17:00';
  if (end && !start) return 'Add a start time as well';
  if (start && end && end <= start) return 'The end must be after the start';
  return null;
}
