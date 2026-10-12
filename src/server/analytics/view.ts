// What every analytics page starts from: the business data, the chosen period and its snapshot.
import { scrubDeep, zeroProfit } from '@/lib/analytics/redact';
import type { CustomRange, PeriodKey, ResolvedPeriod } from '@/lib/analytics/period';
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

const CHANNELS: Channel[] = ['shopify', 'allegro', 'empik', 'vonhalsky'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The view for the signed-in person: guarded by the analytics permission, with profit left out when they may not see it. */
export async function analyticsView(p: ViewParams, fallback: PeriodKey = 'month'): Promise<AnalyticsView> {
  const user = await requireCapability('analytics');
  return buildAnalyticsView(p, can(user.role, 'profit'), fallback);
}

export async function buildAnalyticsView(p: ViewParams, showProfit: boolean, fallback: PeriodKey = 'month'): Promise<AnalyticsView> {
  const marketplace = CHANNELS.includes(p.marketplace as Channel) ? (p.marketplace as Channel) : undefined;
  const data = await loadBusinessData({ marketplace });
  const custom: CustomRange | undefined =
    p.from && p.to && DAY.test(p.from) && DAY.test(p.to) ? { from: new Date(`${p.from}T00:00:00Z`), to: new Date(`${p.to}T23:59:59Z`) } : undefined;
  const periodKey = custom ? 'custom' : parsePeriodKey(p.period, fallback);
  const period = periodFor(data, periodKey, custom);
  const full = snapshotFor(data, period);
  const snapshot = showProfit
    ? full
    : {
        ...zeroProfit(full),
        // The generated sentences name profit amounts; keep the findings but not those figures.
        insights: full.insights.map((i) => {
          const s = scrubDeep(i);
          return { ...s, why: s.why || s.title };
        }),
        health: scrubDeep(full.health),
        kpis: full.kpis.filter((k) => k.key !== 'profit'),
      };
  return {
    data,
    period,
    periodKey,
    snapshot,
    fullSnapshot: full,
    showProfit,
    marketplace,
    params: { period: custom ? undefined : p.period, marketplace, from: custom ? p.from : undefined, to: custom ? p.to : undefined },
  };
}
