// The time window of the pages that pick "the last N days": Operations and Inventory. Besides the rolling
// windows they offer last week (the whole Monday-to-Sunday week) and any two dates typed in.
// Days are the shop's days: they begin and end at midnight in Warsaw, like the day columns of Operations.
import { parseCustomRange } from './period';

const DAY_MS = 86_400_000;
export const SHOP_TIME_ZONE = 'Europe/Warsaw';

export interface DayWindow {
  /** The `days` parameter that selects it: a number of days, `lastweek`, or `custom` (then `from`/`to` are in the URL). */
  key: string;
  /** Short wording for headings and tiles, e.g. "30 days", "last week", "3 Oct – 9 Oct". */
  label: string;
  from: Date;
  to: Date;
  /** The custom days as `YYYY-MM-DD`, only for a custom window. */
  custom?: { from: string; to: string };
}

const ymd = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const plusDays = (day: string, days: number) => ymd(Date.parse(`${day}T00:00:00Z`) + days * DAY_MS);

/** Milliseconds the zone is ahead of UTC at a moment (1 or 2 hours in Warsaw). */
function offsetMs(at: number, timeZone: string): number {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' })
      .formatToParts(new Date(at))
      .map((x) => [x.type, Number(x.value)]),
  );
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(at / 1000) * 1000;
}

/** The moment a calendar day (`YYYY-MM-DD`) begins in the zone. */
export function dayStart(day: string, timeZone = SHOP_TIME_ZONE): Date {
  const utc = Date.parse(`${day}T00:00:00Z`);
  // The offset at midnight itself decides; guessing with the offset of the previous instant settles on the right one.
  const guess = utc - offsetMs(utc, timeZone);
  return new Date(utc - offsetMs(guess, timeZone));
}

/** The last millisecond of a calendar day in the zone. */
export function dayEnd(day: string, timeZone = SHOP_TIME_ZONE): Date {
  return new Date(dayStart(plusDays(day, 1), timeZone).getTime() - 1);
}

/** Today's calendar day in the zone, `YYYY-MM-DD`. */
export function today(now = new Date(), timeZone = SHOP_TIME_ZONE): string {
  return ymd(now.getTime() + offsetMs(now.getTime(), timeZone));
}

/** The Monday of the week a day falls in. */
function mondayOf(day: string): string {
  return plusDays(day, -((new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7));
}

function shortDay(day: string): string {
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00Z`));
}

/**
 * `days` is one of `allowed` (rolling, ending now) or `lastweek`; a valid `from` and `to` pair wins over both.
 * Anything else falls back to the last `fallback` days, so a stale or hand-edited link still shows a page.
 */
export function resolveDayWindow(input: { days?: string; from?: string; to?: string }, allowed: readonly number[], fallback: number, now = new Date()): DayWindow {
  const typed = parseCustomRange(input.from, input.to);
  if (typed) {
    const custom = { from: ymd(typed.from.getTime()), to: ymd(typed.to.getTime()) };
    return { key: 'custom', label: `${shortDay(custom.from)} – ${shortDay(custom.to)}`, from: dayStart(custom.from), to: dayEnd(custom.to), custom };
  }
  if (input.days === 'lastweek') {
    const monday = plusDays(mondayOf(today(now)), -7);
    return { key: 'lastweek', label: 'last week', from: dayStart(monday), to: dayEnd(plusDays(monday, 6)) };
  }
  const days = allowed.find((d) => String(d) === input.days) ?? fallback;
  return { key: String(days), label: `${days} days`, from: new Date(now.getTime() - days * DAY_MS), to: now };
}

/** One-tap day ranges for a plain "from – until" filter (the Orders list), as `YYYY-MM-DD` pairs. */
export function quickRanges(now = new Date()): { label: string; from: string; to: string }[] {
  const t = today(now);
  const monday = mondayOf(t);
  return [
    { label: 'Today', from: t, to: t },
    { label: 'Yesterday', from: plusDays(t, -1), to: plusDays(t, -1) },
    { label: 'This week', from: monday, to: t },
    { label: 'Last week', from: plusDays(monday, -7), to: plusDays(monday, -1) },
    { label: 'This month', from: `${t.slice(0, 8)}01`, to: t },
  ];
}
