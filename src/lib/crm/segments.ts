// Customer segments, cohorts and repeat-purchase figures. Pure functions over plain customer and
// order data, so the rules are unit-tested and shared by the pages and the Shopify tag sync.

export interface CustomerFacts {
  id: string;
  ordersCount: number;
  revenue: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

export type SegmentKey = 'vip' | 'loyal' | 'promising' | 'new' | 'one_time' | 'at_risk' | 'cant_lose' | 'lost';

export const SEGMENTS: Record<SegmentKey, { label: string; description: string; tone: 'green' | 'blue' | 'amber' | 'red' | 'violet' | 'gray' | 'orange'; action: string }> = {
  vip: { label: 'VIP', description: '3+ orders, bought recently, top spenders.', tone: 'violet', action: 'Thank them, give early access, ask for reviews.' },
  loyal: { label: 'Loyal', description: '3+ orders and still buying.', tone: 'green', action: 'Recommend the next product in their routine.' },
  promising: { label: 'Promising', description: 'A second order, recently.', tone: 'blue', action: 'Nudge towards a third order with a routine bundle.' },
  new: { label: 'New', description: 'First order in the last 30 days.', tone: 'blue', action: 'Welcome them; suggest what pairs with what they bought.' },
  one_time: { label: 'One-time', description: 'One order, 1–4 months ago.', tone: 'gray', action: 'A reminder or a sample to win the second order.' },
  at_risk: { label: 'At risk', description: 'Bought 2+ times, but not for 4+ months.', tone: 'amber', action: 'Win back before they go: a personal offer.' },
  cant_lose: { label: "Can't lose", description: 'Top spenders with 3+ orders who stopped buying.', tone: 'red', action: 'Reach out personally; find out what changed.' },
  lost: { label: 'Lost', description: 'One order, over 4 months ago.', tone: 'gray', action: 'Low priority; include in broad campaigns only.' },
};

export const SEGMENT_ORDER: SegmentKey[] = ['vip', 'loyal', 'promising', 'new', 'one_time', 'at_risk', 'cant_lose', 'lost'];

const DAY = 86_400_000;

/** 5 = bought in the last 30 days … 1 = over 8 months ago. */
export function recencyScore(daysSince: number): number {
  if (daysSince <= 30) return 5;
  if (daysSince <= 60) return 4;
  if (daysSince <= 120) return 3;
  if (daysSince <= 240) return 2;
  return 1;
}

/** Spend quintile (1–5) of every customer, by lifetime revenue. */
export function monetaryScores(list: CustomerFacts[]): Map<string, number> {
  const sorted = [...list].sort((a, b) => a.revenue - b.revenue);
  const out = new Map<string, number>();
  sorted.forEach((c, i) => out.set(c.id, Math.min(5, 1 + Math.floor((i / Math.max(1, sorted.length)) * 5))));
  return out;
}

export interface Scored {
  segment: SegmentKey;
  recency: number;
  monetary: number;
  daysSince: number | null;
}

/** Segment of every customer with at least one order. */
export function segmentCustomers(list: CustomerFacts[], now = new Date()): Map<string, Scored> {
  const buying = list.filter((c) => c.ordersCount > 0 && c.lastOrderAt);
  const money = monetaryScores(buying);
  const out = new Map<string, Scored>();
  for (const c of buying) {
    const daysSince = Math.floor((now.getTime() - c.lastOrderAt!.getTime()) / DAY);
    const r = recencyScore(daysSince);
    const m = money.get(c.id) ?? 1;
    let segment: SegmentKey;
    if (c.ordersCount >= 3) segment = r >= 4 && m >= 4 ? 'vip' : r >= 3 ? 'loyal' : m >= 4 ? 'cant_lose' : 'at_risk';
    else if (c.ordersCount === 2) segment = r >= 3 ? 'promising' : 'at_risk';
    else segment = r >= 5 ? 'new' : r >= 3 ? 'one_time' : 'lost';
    out.set(c.id, { segment, recency: r, monetary: m, daysSince });
  }
  return out;
}

export interface RepeatStats {
  customers: number;
  repeatCustomers: number;
  /** Share of customers with 2+ orders, 0–1. */
  repeatRate: number;
  /** Median days from the first to the second order, for those who came back. */
  medianDaysToSecond: number | null;
  averageOrders: number;
  averageRevenue: number;
}

/** `orderDates`: each customer's order dates, oldest first. */
export function repeatStats(list: CustomerFacts[], orderDates: Map<string, Date[]>): RepeatStats {
  const buying = list.filter((c) => c.ordersCount > 0);
  const repeat = buying.filter((c) => c.ordersCount >= 2);
  const gaps = repeat
    .map((c) => orderDates.get(c.id))
    .filter((d): d is Date[] => Boolean(d && d.length >= 2))
    .map((d) => (d[1].getTime() - d[0].getTime()) / DAY)
    .sort((a, b) => a - b);
  return {
    customers: buying.length,
    repeatCustomers: repeat.length,
    repeatRate: buying.length ? repeat.length / buying.length : 0,
    medianDaysToSecond: gaps.length ? Math.round(gaps[Math.floor(gaps.length / 2)]) : null,
    averageOrders: buying.length ? buying.reduce((s, c) => s + c.ordersCount, 0) / buying.length : 0,
    averageRevenue: buying.length ? buying.reduce((s, c) => s + c.revenue, 0) / buying.length : 0,
  };
}

export interface Cohort {
  /** YYYY-MM of the first order. */
  month: string;
  size: number;
  /** Share of the cohort ordering again in month +1, +2, … (index 0 = the first month, always 1). */
  retention: (number | null)[];
}

/** Monthly cohorts by first order, with the share of each cohort that ordered in each later month. */
export function cohorts(orderDates: Map<string, Date[]>, months = 12, now = new Date()): Cohort[] {
  const ym = (d: Date) => d.toISOString().slice(0, 7);
  const index = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
  const current = ym(now);
  const byCohort = new Map<string, { size: number; active: Map<number, number> }>();
  for (const dates of orderDates.values()) {
    if (!dates.length) continue;
    const first = ym(dates[0]);
    const cohort = byCohort.get(first) ?? { size: 0, active: new Map<number, number>() };
    cohort.size++;
    for (const k of new Set(dates.map((d) => index(first, ym(d))))) if (k > 0) cohort.active.set(k, (cohort.active.get(k) ?? 0) + 1);
    byCohort.set(first, cohort);
  }
  return [...byCohort.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .slice(0, months)
    .map(([month, c]) => ({
      month,
      size: c.size,
      retention: Array.from({ length: months }, (_, k) => (k === 0 ? 1 : k > index(month, current) ? null : (c.active.get(k) ?? 0) / c.size)),
    }));
}

/**
 * Customers who usually come back but are now overdue: at least 2 orders, and more than twice
 * their usual gap since the last one.
 */
export function overdueCustomers(orderDates: Map<string, Date[]>, now = new Date()): { id: string; usualGapDays: number; daysSince: number }[] {
  const out: { id: string; usualGapDays: number; daysSince: number }[] = [];
  for (const [id, dates] of orderDates) {
    if (dates.length < 2) continue;
    const gaps = dates.slice(1).map((d, i) => (d.getTime() - dates[i].getTime()) / DAY);
    const usual = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    const since = (now.getTime() - dates[dates.length - 1].getTime()) / DAY;
    if (usual >= 1 && since > usual * 2) out.push({ id, usualGapDays: Math.round(usual), daysSince: Math.round(since) });
  }
  return out.sort((a, b) => b.daysSince / b.usualGapDays - a.daysSince / a.usualGapDays);
}

/** The Shopify tag for a segment, e.g. "luora-vip". */
export function segmentTag(segment: SegmentKey): string {
  return `luora-${segment.replace('_', '-')}`;
}
