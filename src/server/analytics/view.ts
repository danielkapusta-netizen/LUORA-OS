// What every analytics page starts from: the business data, the chosen period and its snapshot.
import { scrubDeep, zeroProfit } from '@/lib/analytics/redact';
import { parseCustomRange, sameTimeYesterday, type PeriodKey, type ResolvedPeriod } from '@/lib/analytics/period';
import { dayEnd, dayStart, plusDays, today as shopToday } from '@/lib/analytics/window';
import type { Snapshot } from '@/lib/analytics/snapshot';
import type { Channel } from '@/lib/analytics/types';
import { can } from '@/lib/permissions';
import { requireCapability } from '../auth';
import { loadBusinessData, parsePeriodKey, periodFor, snapshotFor, type BusinessData } from './dataset';

export interface ViewParams {
  period?: string;
  marketplace?: string;
  from?: string;
  to?: string;
}

export interface AnalyticsView {
  data: BusinessData;
  period: ResolvedPeriod;
  periodKey: PeriodKey;
  /** What pages show. Without the profit permission its profit figures are zero and its sentences carry none. */
  snapshot: Snapshot;
  /** The untouched snapshot, for server-side builders whose output is then scrubbed. */
  fullSnapshot: Snapshot;
  marketplace?: Channel;
  /** False for roles that see margins but not how much profit was made: pages hide profit amounts. */
  showProfit: boolean;
  /** The query parameters that define the view, to keep when linking within it. */
  params: Record<string, string | undefined>;
}

const CHANNELS: Channel[] = ['shopify', 'allegro', 'empik', 'vonhalsky', 'hebe', 'erli'];

/** The view for the signed-in person: guarded by the analytics permission, with profit left out when they may not see it. */
export async function analyticsView(p: ViewParams, fallback: PeriodKey = 'month'): Promise<AnalyticsView> {
  const user = await requireCapability('analytics');
  return buildAnalyticsView(p, can(user.role, 'profit'), fallback);
}

export async function buildAnalyticsView(p: ViewParams, showProfit: boolean, fallback: PeriodKey = 'month'): Promise<AnalyticsView> {
  const marketplace = CHANNELS.includes(p.marketplace as Channel) ? (p.marketplace as Channel) : undefined;
  const data = await loadBusinessData({ marketplace });
  const custom = parseCustomRange(p.from, p.to);
  const requested = parsePeriodKey(p.period, fallback);
  // "custom" without usable dates means nothing; fall back rather than show a one-day window.
  const periodKey = custom ? 'custom' : requested === 'custom' ? fallback : requested;
  const period = periodFor(data, periodKey, custom);
  const full = snapshotFor(data, period);
  const snapshot = forViewer(full, showProfit);
  return {
    data,
    period,
    periodKey,
    snapshot,
    fullSnapshot: full,
    showProfit,
    marketplace,
    params: {
      period: custom ? undefined : periodKey === requested ? p.period : undefined,
      marketplace,
      from: custom ? custom.from.toISOString().slice(0, 10) : undefined,
      to: custom ? custom.to.toISOString().slice(0, 10) : undefined,
    },
  };
}

/** A snapshot as the viewer may see it: without the profit permission its profit figures are zero and its sentences carry none. */
export function forViewer(full: Snapshot, showProfit: boolean): Snapshot {
  if (showProfit) return full;
  return {
    ...zeroProfit(full),
    // The generated sentences name profit amounts; keep the findings but not those figures.
    insights: full.insights.map((i) => {
      const s = scrubDeep(i);
      return { ...s, why: s.why || s.title };
    }),
    health: scrubDeep(full.health),
    kpis: full.kpis.filter((k) => k.key !== 'profit'),
  };
}

/**
 * Today (Warsaw day) across every marketplace, for the Dashboard's daily summary, against yesterday by the same hour. Reuses the view's data when it isn't
 * narrowed to one marketplace, so the page reads the business data once.
 */
export async function todaySnapshot(view: AnalyticsView, now = new Date()): Promise<Snapshot> {
  const data = view.marketplace ? await loadBusinessData({}) : view.data;
  // The shop's day runs from midnight in Warsaw (analytics periods otherwise use UTC days), and it is compared with
  // yesterday up to the same time of day, so the morning's figures are not set against a whole day.
  const day = shopToday(now);
  const start = dayStart(day);
  const period = { ...periodFor(data, 'today', undefined, now), from: start, to: dayEnd(day), previous: { from: dayStart(plusDays(day, -1)), to: new Date(start.getTime() - 1) } };
  return forViewer(snapshotFor(data, sameTimeYesterday(period, now)), view.showProfit);
}
